//! Phase A3: in-memory sliding-window rate limiter for `/api/auth/login`.
//!
//! Two scopes share the same window + budget so a single check covers both:
//!
//!   * **per-IP** — guards against scrapes from a single source.
//!   * **per-username** — guards distributed attacks against one account.
//!
//! Hits are recorded only after both scopes pass, so a 429 reply does not
//! consume an additional slot. State is in-memory: a process restart resets
//! the budget, which is intentional. We reach for a persistent store the
//! day this single-tenant fork has more than one node.
//!
//! The limiter is exercised from `auth::routes::login` via
//! [`ServerState::login_limiter`]. Tests in this module use injected
//! `Instant` values so they don't depend on wall-clock timing.
//!
//! Why VecDeque + filter (not a more elaborate token bucket): the budget
//! is small (5 by default), so an O(BUDGET) scan per call is cheaper than
//! the bookkeeping of a fancier algorithm and is easier to read in review.

use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Maximum login attempts permitted within [`WINDOW`]. The (BUDGET+1)-th hit
/// inside the window returns 429 + `Retry-After`.
pub const BUDGET: usize = 5;

/// Sliding window length. 60 seconds keeps `Retry-After` advice short
/// enough for a real human to wait through if they typo'd, while still
/// frustrating a script that's hammering the endpoint.
pub const WINDOW: Duration = Duration::from_secs(60);

/// In-memory limiter keyed independently by IP and by username. Cheap to
/// clone via `Arc` in `ServerState`.
#[derive(Default)]
pub struct LoginRateLimiter {
    by_ip: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
    by_user: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl LoginRateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Decide whether `(ip, username)` may attempt a login at `now`.
    ///
    /// Returns `Some(retry_after_secs)` when over budget — the caller
    /// should reply 429 with that value in `Retry-After`. `None` means
    /// go-ahead, and a hit is recorded against both scopes.
    ///
    /// `now` is injected so tests can drive the limiter without sleeping.
    /// In production callers pass `Instant::now()`.
    pub fn check_and_register(
        &self,
        ip: IpAddr,
        username: &str,
        now: Instant,
    ) -> Option<u64> {
        if let Some(retry) = check_scope(&self.by_ip, &ip, now) {
            return Some(retry);
        }
        if let Some(retry) = check_scope(&self.by_user, username, now) {
            return Some(retry);
        }
        record_scope(&self.by_ip, ip, now);
        record_scope(&self.by_user, username.to_string(), now);
        None
    }
}

fn check_scope<K, Q>(
    map: &Mutex<HashMap<K, VecDeque<Instant>>>,
    key: &Q,
    now: Instant,
) -> Option<u64>
where
    K: Eq + Hash + std::borrow::Borrow<Q>,
    Q: Eq + Hash + ?Sized,
{
    let guard = map.lock().expect("rate-limit mutex poisoned");
    let window = guard.get(key)?;
    let cutoff = now.checked_sub(WINDOW)?;
    let live_count = window.iter().filter(|&&t| t > cutoff).count();
    if live_count >= BUDGET {
        // VecDeque is push_back-ordered, so the first entry past the cutoff
        // is the oldest live one — that's when the next slot frees.
        let oldest_live = window.iter().find(|&&t| t > cutoff)?;
        let retry = oldest_live
            .checked_add(WINDOW)
            .map(|until| until.saturating_duration_since(now))
            .unwrap_or(WINDOW);
        // Always at least 1s so clients get a meaningful Retry-After.
        Some(retry.as_secs().max(1))
    } else {
        None
    }
}

fn record_scope<K>(
    map: &Mutex<HashMap<K, VecDeque<Instant>>>,
    key: K,
    now: Instant,
) where
    K: Eq + Hash,
{
    let mut guard = map.lock().expect("rate-limit mutex poisoned");
    let entry = guard.entry(key).or_default();
    let cutoff = now.checked_sub(WINDOW).unwrap_or(now);
    while entry.front().is_some_and(|&t| t <= cutoff) {
        entry.pop_front();
    }
    entry.push_back(now);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn allows_first_budget_attempts_blocks_next() {
        let lim = LoginRateLimiter::new();
        let t0 = Instant::now();
        for i in 0..BUDGET {
            assert_eq!(
                lim.check_and_register(
                    ip("127.0.0.1"),
                    "alice",
                    t0 + Duration::from_secs(i as u64),
                ),
                None,
                "attempt {i} should be allowed",
            );
        }
        let retry = lim.check_and_register(
            ip("127.0.0.1"),
            "alice",
            t0 + Duration::from_secs(BUDGET as u64),
        );
        assert!(retry.is_some(), "(BUDGET+1)-th attempt must be rate-limited");
        assert!(retry.unwrap() >= 1);
    }

    #[test]
    fn frees_slot_after_window_expires() {
        let lim = LoginRateLimiter::new();
        let t0 = Instant::now();
        for _ in 0..BUDGET {
            lim.check_and_register(ip("10.0.0.1"), "bob", t0);
        }
        // One window past the recorded hits → oldest slot frees.
        let later = t0 + WINDOW + Duration::from_secs(1);
        assert_eq!(
            lim.check_and_register(ip("10.0.0.1"), "bob", later),
            None,
            "after window, a new attempt should be allowed",
        );
    }

    #[test]
    fn user_scope_trips_even_on_fresh_ip() {
        let lim = LoginRateLimiter::new();
        let t0 = Instant::now();
        // Saturate the user-scope from one IP.
        for _ in 0..BUDGET {
            lim.check_and_register(ip("10.0.0.1"), "bob", t0);
        }
        // Switch IP; user-scope still saturated → 429.
        let blocked = lim.check_and_register(ip("10.0.0.2"), "bob", t0);
        assert!(
            blocked.is_some(),
            "per-username scope must defend across IPs",
        );
    }

    #[test]
    fn distinct_users_are_isolated() {
        let lim = LoginRateLimiter::new();
        let t0 = Instant::now();
        for _ in 0..BUDGET {
            lim.check_and_register(ip("10.0.0.1"), "bob", t0);
        }
        // Different IP + different user is fully fresh.
        assert_eq!(
            lim.check_and_register(ip("10.0.0.2"), "carol", t0),
            None,
        );
    }

    #[test]
    fn blocked_attempts_do_not_consume_slot() {
        let lim = LoginRateLimiter::new();
        let t0 = Instant::now();
        for _ in 0..BUDGET {
            lim.check_and_register(ip("10.0.0.1"), "bob", t0);
        }
        // Two blocked attempts at t0 must not push entries.
        assert!(lim.check_and_register(ip("10.0.0.1"), "bob", t0).is_some());
        assert!(lim.check_and_register(ip("10.0.0.1"), "bob", t0).is_some());
        // After the window, BUDGET fresh slots should still be available.
        let later = t0 + WINDOW + Duration::from_secs(1);
        for i in 0..BUDGET {
            assert_eq!(
                lim.check_and_register(
                    ip("10.0.0.1"),
                    "bob",
                    later + Duration::from_secs(i as u64),
                ),
                None,
                "post-window attempt {i} should be allowed",
            );
        }
    }
}
