<script lang="ts">
    import { onMount } from "svelte";
    import { auth } from "$lib/auth.svelte";
    import { Caption } from "$lib/components/ui";
    import {
        SketchGear,
        SketchUser,
        SketchClock,
        SketchSpark,
        SketchCardStack,
        SketchFlame,
        SketchGlobe,
        SketchLeaf,
        SketchLock,
        SketchPlus,
        SketchCheck,
    } from "$lib/components/sketch";
    import {
        getThemeChoice,
        setThemeChoice,
        type ThemeChoice,
    } from "$lib/theme";
    import {
        deleteDeckConfig,
        deleteNotetypeField,
        fetchAdminUsers,
        fetchDeckConfigById,
        fetchDeckConfigs,
        fetchFsrsEnabled,
        fetchFsrsHealthCheck,
        fetchNotetypes,
        getCard,
        patchDeckConfigById,
        patchNotetypeName,
        postAdminCreateUser,
        postAdminDisable,
        postAdminResetPassword,
        postAuthChangePassword,
        postDeckConfig,
        postFsrsOptimize,
        postNotetypeField,
        putFsrsEnabled,
        putFsrsHealthCheck,
        resetCardToNew,
        type ApiAdminUser,
        type ApiCardSummary,
        type ApiDeckConfigListItem,
        type ApiNotetypeSummary,
    } from "$lib/api";

    const DEFAULT_PRESET_ID = 1;

    // Phase B2: the admin section only appears when the server reports
    // `auth.user.is_admin` true (env-configured `ANKI_ADMIN_USERNAME`
    // matches this user). `$derived` rebuilds the list when auth state
    // flips, so a refresh-after-login or admin-disable flow surfaces the
    // panel correctly without a manual reload.
    let sections = $derived.by(() => {
        const list = [
            { id: "profile", label: "Profile" },
            { id: "scheduling", label: "Scheduling" },
            { id: "fsrs", label: "FSRS" },
            { id: "notetypes", label: "Notetypes" },
            { id: "recovery", label: "Recovery" },
            { id: "sync", label: "Sync" },
            { id: "appearance", label: "Appearance" },
            { id: "advanced", label: "Advanced" },
        ];
        if (auth.user?.is_admin) {
            list.push({ id: "admin", label: "Admin" });
        }
        return list;
    });

    let active = $state("fsrs");
    let themeChoice: ThemeChoice = $state("light");

    // FSRS settings wired to anki_server (Phase 9-N2; optimize/reschedule 9-O2;
    // multi-preset selector 9-O''). Server stores desired_retention as a
    // 0.70..=0.97 float; UI works in integer percent and converts at the
    // boundary. Persistence fires on change/blur (not input/keystroke) so a
    // slider drag is one PATCH.
    let loading = $state(true);
    let loadError: string | null = $state(null);
    let presets: ApiDeckConfigListItem[] = $state([]);
    let selectedPresetId = $state<number | null>(null);
    let switchingPreset = $state(false);
    let retentionPct = $state(90);
    let maxInterval = $state(36500);
    let fsrsEnabled = $state(false);
    let savingRetention = $state(false);
    let savingMaxInterval = $state(false);
    let savingFsrs = $state(false);
    let errorRetention: string | null = $state(null);
    let errorMaxInterval: string | null = $state(null);
    let errorFsrs: string | null = $state(null);

    // Phase 15-B: FSRS health-check toggle. Collection-level flag that
    // tells the next optimize / enable-flip to run rslib's trained-
    // params sanity check. Lives next to Re-optimize (not the Enable
    // FSRS toggle) because it only takes effect when an optimize-
    // adjacent action runs — flipping it on its own is silent.
    let fsrsHealthCheck = $state(false);
    let savingHealthCheck = $state(false);
    let errorHealthCheck: string | null = $state(null);

    // Phase 10-C: per-preset scheduling caps. Same onblur+PATCH pattern as
    // maxInterval — drag/keystroke does not persist, only blur or change.
    let newPerDay = $state(20);
    let reviewsPerDay = $state(200);
    let capAnswerTimeSecs = $state(60);
    let savingNewPerDay = $state(false);
    let savingReviewsPerDay = $state(false);
    let savingCapAnswerTime = $state(false);
    let errorNewPerDay: string | null = $state(null);
    let errorReviewsPerDay: string | null = $state(null);
    let errorCapAnswerTime: string | null = $state(null);

    // Phase 17-C: new-card insert order toggle. Segmented control with two
    // options ("due" / "random") — persists immediately on click rather
    // than onblur because the underlying control is a button group, not a
    // text input. Same fail-then-rollback pattern as the other persisters.
    let newCardOrder: "due" | "random" = $state("due");
    let savingNewCardOrder = $state(false);
    let errorNewCardOrder: string | null = $state(null);

    // Optimize state. Phase 9-O' hydrates params from GET response so the
    // weights grid survives page reload. paramsSource distinguishes "loaded
    // from disk" hint copy from "trained this run" — the two share UI but
    // mean different things to the user. Re-evaluated on every preset switch
    // so the hint never lies about the active preset's training history.
    let optimizing = $state(false);
    let errorOptimize: string | null = $state(null);
    let optimizeFsrsItems: number | null = $state(null);
    let optimizedParams: number[] = $state([]);
    let paramsSource: "disk" | "fresh" | null = $state(null);

    // Phase 12-B: create-new-preset inline form. Hidden until user opts in
    // so the default settings layout stays the same; cancel restores it.
    let creatingPreset = $state(false);
    let newPresetName = $state("");
    let savingCreatePreset = $state(false);
    let errorCreatePreset: string | null = $state(null);

    // Phase 13-B: delete-preset state. We don't have a busy-overlay UX, so
    // disable the Delete button + show inline status while the request is
    // in flight. Errors surface in the same field-error slot as create.
    let deletingPreset = $state(false);
    let errorDeletePreset: string | null = $state(null);

    // Phase 16-B: inline notetype rename. Lazy-loaded — fetchNotetypes
    // only fires when the user clicks the "Notetypes" sidebar tab so the
    // initial settings paint stays cheap. Per-row edit state keeps the
    // UX one-row-at-a-time (mirrors the 9-S browse tree rename pattern).
    let notetypes = $state<ApiNotetypeSummary[] | null>(null);
    let loadingNotetypes = $state(false);
    let errorNotetypesLoad: string | null = $state(null);
    let editingNotetypeId = $state<number | null>(null);
    let notetypeNameDraft = $state("");
    let savingNotetypeRename = $state(false);
    let errorNotetypeRename: string | null = $state(null);

    // Phase 19-B: per-notetype field management. `expandedNotetypeId`
    // gates which row's fields list is visible (one-at-a-time mirrors
    // the rename pattern). `addingFieldNotetypeId` separately tracks
    // the row whose "+ New field" inline form is open — distinct from
    // expansion so a user can keep multiple fields lists collapsed
    // while typing into one. Errors are scoped per-row in
    // `errorAddField` so a failed save on one notetype doesn't poison
    // sibling rows' UI.
    let expandedNotetypeId = $state<number | null>(null);
    let addingFieldNotetypeId = $state<number | null>(null);
    let newFieldNameDraft = $state("");
    let savingNewField = $state(false);
    let errorAddField: { id: number; message: string } | null = $state(null);

    // Phase 19-C: per-field delete with two-step confirm. `pendingDelete`
    // tracks which (notetype id, ord) pair has the inline "Delete field?"
    // confirm shown — keyed as a tuple so the destructive-adjacent UX
    // never has more than one row armed at a time. Errors surface via
    // `errorDeleteField` scoped to the notetype id (not the ord) since
    // a failed delete on field 0 shouldn't poison the affordance on
    // field 1.
    let pendingDelete = $state<{ ntId: number; ord: number } | null>(null);
    let savingDeleteField = $state(false);
    let errorDeleteField: { id: number; message: string } | null = $state(
        null,
    );

    // Phase 20-C: burn-recovery — per-card reset to new. Card-id input,
    // a getCard preview, and a two-step destructive confirm matching the
    // 19-C inline pattern (Confirm/Cancel pair replacing the primary
    // button so the card detail panel stays visible while the user
    // makes the call). Errors are scoped to the recovery panel — the
    // Notetypes / FSRS surfaces never see them.
    let recoveryCardIdInput = $state("");
    let recoveryCard: ApiCardSummary | null = $state(null);
    let lookingUpCard = $state(false);
    let errorRecoveryLookup: string | null = $state(null);
    // pendingRecoveryReset gates the Confirm/Cancel pair — same null/
    // value sentinel approach as `pendingDelete` in 19-C so an explicit
    // Cancel restores the "Reset to new" button verbatim.
    let pendingRecoveryReset = $state(false);
    let savingRecoveryReset = $state(false);
    let errorRecoveryReset: string | null = $state(null);
    let recoverySuccess: string | null = $state(null);

    function applyPresetSnapshot(
        conf: {
            desired_retention: number;
            maximum_review_interval: number;
            new_per_day: number;
            reviews_per_day: number;
            cap_answer_time_secs: number;
            new_card_order: "due" | "random";
            fsrs_params: number[];
        },
    ): void {
        retentionPct = Math.round(conf.desired_retention * 100);
        maxInterval = conf.maximum_review_interval;
        newPerDay = conf.new_per_day;
        reviewsPerDay = conf.reviews_per_day;
        capAnswerTimeSecs = conf.cap_answer_time_secs;
        newCardOrder = conf.new_card_order;
        // Copy the array — assigning the incoming reference can leave Svelte's
        // $state proxy referencing a non-tracked array if the caller mutates
        // the source later. Snapshot semantics are what the UI wants here.
        if (conf.fsrs_params.length > 0) {
            optimizedParams = [...conf.fsrs_params];
            paramsSource = "disk";
        } else {
            optimizedParams = [];
            paramsSource = null;
        }
        // Drop any "fresh" optimize-result hint left over from a prior preset.
        optimizeFsrsItems = null;
    }

    // Phase B1: self-service change-password form lives in the sidebar
    // account block under the logout button. Toggle-reveal so the sidebar
    // stays uncluttered when the form isn't in use; on submit we PATCH
    // /api/auth/password and let the server cycle the session id (current
    // device stays logged in, no extra round-trip needed).
    let pwOpen = $state(false);
    let pwCurrent = $state("");
    let pwNew = $state("");
    let pwConfirm = $state("");
    let pwSaving = $state(false);
    let pwError: string | null = $state(null);
    let pwSuccess = $state(false);

    function resetPasswordForm(): void {
        pwCurrent = "";
        pwNew = "";
        pwConfirm = "";
        pwError = null;
    }

    function togglePwOpen(): void {
        pwOpen = !pwOpen;
        pwSuccess = false;
        if (!pwOpen) resetPasswordForm();
    }

    async function submitPasswordChange(event: Event): Promise<void> {
        event.preventDefault();
        if (pwSaving) return;
        pwError = null;
        pwSuccess = false;
        if (!pwCurrent) {
            pwError = "current password required";
            return;
        }
        if (!pwNew) {
            pwError = "new password required";
            return;
        }
        if (pwNew !== pwConfirm) {
            pwError = "new password and confirmation don't match";
            return;
        }
        if (pwNew === pwCurrent) {
            pwError = "new password must differ from the current password";
            return;
        }
        pwSaving = true;
        try {
            await postAuthChangePassword(pwCurrent, pwNew);
            pwSuccess = true;
            pwOpen = false;
            resetPasswordForm();
        } catch (err) {
            pwError = err instanceof Error ? err.message : String(err);
        } finally {
            pwSaving = false;
        }
    }

    // Phase B2: admin user panel state + handlers. Lazy-loaded — we only
    // hit /api/admin/users when the operator actually navigates to the
    // admin tab, so non-admin users (most calls) never pay the round-
    // trip and the cold path on first nav is one fetch instead of one-
    // per-onMount.
    let adminUsers: ApiAdminUser[] = $state([]);
    let adminLoading = $state(false);
    let adminLoadedOnce = false;
    let adminError: string | null = $state(null);
    let adminBusyUser: string | null = $state(null);
    let adminSuccess: string | null = $state(null);
    // Reset-password inline form state. Only one row's form is open at a
    // time — opening another row closes the first, like a list of
    // accordion entries.
    let adminResetUser: string | null = $state(null);
    let adminResetNew = $state("");
    let adminResetConfirm = $state("");
    let adminResetError: string | null = $state(null);
    let adminResetSaving = $state(false);
    // WS2: inline "add user" form state. Mirrors the reset-password form's
    // shape (own error line, own saving flag) so the two admin sub-forms
    // behave identically. On success we refetch the list (rather than
    // optimistically splice) because the server assigns the id/created_at
    // and we'd rather show the real row than guess it.
    let adminCreateUsername = $state("");
    let adminCreatePassword = $state("");
    let adminCreateError: string | null = $state(null);
    let adminCreateSaving = $state(false);

    async function loadAdminUsers(): Promise<void> {
        adminLoading = true;
        adminError = null;
        try {
            const list = await fetchAdminUsers();
            adminUsers = list.users;
            adminLoadedOnce = true;
        } catch (err) {
            adminError = err instanceof Error ? err.message : String(err);
        } finally {
            adminLoading = false;
        }
    }

    // Fetch on first switch to the admin tab; later switches reuse the
    // cached list until the operator hits the explicit refresh button.
    $effect(() => {
        if (active === "admin" && auth.user?.is_admin && !adminLoadedOnce && !adminLoading) {
            void loadAdminUsers();
        }
    });

    function closeAdminResetForm(): void {
        adminResetUser = null;
        adminResetNew = "";
        adminResetConfirm = "";
        adminResetError = null;
    }

    function openAdminResetForm(username: string): void {
        // Toggle behaviour: re-clicking the same row's "reset" closes it.
        if (adminResetUser === username) {
            closeAdminResetForm();
            return;
        }
        closeAdminResetForm();
        adminResetUser = username;
        adminSuccess = null;
    }

    async function submitAdminReset(event: Event): Promise<void> {
        event.preventDefault();
        if (adminResetSaving || !adminResetUser) return;
        adminResetError = null;
        if (!adminResetNew) {
            adminResetError = "new password required";
            return;
        }
        if (adminResetNew !== adminResetConfirm) {
            adminResetError = "new password and confirmation don't match";
            return;
        }
        adminResetSaving = true;
        try {
            await postAdminResetPassword(adminResetUser, adminResetNew);
            adminSuccess = `// password reset for ${adminResetUser} — their sessions were revoked`;
            closeAdminResetForm();
        } catch (err) {
            adminResetError = err instanceof Error ? err.message : String(err);
        } finally {
            adminResetSaving = false;
        }
    }

    async function submitAdminCreate(event: Event): Promise<void> {
        event.preventDefault();
        if (adminCreateSaving) return;
        adminCreateError = null;
        const username = adminCreateUsername.trim();
        if (!username) {
            adminCreateError = "username required";
            return;
        }
        if (!adminCreatePassword) {
            adminCreateError = "password required";
            return;
        }
        adminCreateSaving = true;
        try {
            await postAdminCreateUser(username, adminCreatePassword);
            adminCreateUsername = "";
            adminCreatePassword = "";
            adminSuccess = `// created ${username} — they can log in with the password you set`;
            // Refetch so the new row (with its server-assigned id) shows up
            // and any stale list state is reconciled — same move the
            // refresh button makes.
            await loadAdminUsers();
        } catch (err) {
            adminCreateError = err instanceof Error ? err.message : String(err);
        } finally {
            adminCreateSaving = false;
        }
    }

    async function toggleAdminDisable(user: ApiAdminUser): Promise<void> {
        if (adminBusyUser) return;
        adminBusyUser = user.username;
        adminError = null;
        adminSuccess = null;
        const targetDisabled = user.disabled_at === null; // flip
        try {
            await postAdminDisable(user.username, targetDisabled);
            adminSuccess = targetDisabled
                ? `// disabled ${user.username} — their sessions were revoked`
                : `// re-enabled ${user.username}`;
            // Optimistic local update so the toggle reflects immediately
            // without waiting for a list refetch.
            adminUsers = adminUsers.map((u) =>
                u.username === user.username
                    ? { ...u, disabled_at: targetDisabled ? Math.floor(Date.now() / 1000) : null }
                    : u,
            );
        } catch (err) {
            adminError = err instanceof Error ? err.message : String(err);
        } finally {
            adminBusyUser = null;
        }
    }

    onMount(async () => {
        themeChoice = getThemeChoice();
        try {
            const [list, fsrs, hc] = await Promise.all([
                fetchDeckConfigs(),
                fetchFsrsEnabled(),
                fetchFsrsHealthCheck(),
            ]);
            presets = list.configs;
            fsrsEnabled = fsrs.enabled;
            fsrsHealthCheck = hc.enabled;
            // Default preset id=1 always exists on a fresh collection; fall
            // back to the first listed preset only when the seeded row is
            // absent (corrupt/stripped collection).
            const initial = presets.find((p) => p.id === 1) ?? presets[0];
            if (!initial) {
                throw new Error("No deck config presets available");
            }
            selectedPresetId = initial.id;
            const conf = await fetchDeckConfigById(initial.id);
            applyPresetSnapshot(conf);
        } catch (e) {
            loadError = e instanceof Error ? e.message : "Failed to load settings";
        } finally {
            loading = false;
        }
    });

    function disabledControls(): boolean {
        return loading || loadError !== null || selectedPresetId === null;
    }

    async function createPreset(): Promise<void> {
        // Defensive trim+blank-check matches the server's first 400 path —
        // surface inline before the request, but keep the server-side
        // duplicate / 500 handling generic via the catch below.
        const name = newPresetName.trim();
        if (name === "") {
            errorCreatePreset = "name must not be empty";
            return;
        }
        savingCreatePreset = true;
        errorCreatePreset = null;
        try {
            const created = await postDeckConfig({ name });
            // Append the new preset and switch to it so the editor below
            // shows its (default) state immediately. We don't refetch the
            // whole list — server returns the canonical row, and the
            // duplicate-name guard means the local append can't drift.
            presets = [...presets, { id: created.id, name: created.name }];
            // switchPreset short-circuits if nextId === selectedPresetId,
            // so freshly-created presets — whose ids never collide with
            // the current selection (epoch-ms vs default=1) — always
            // hydrate via fetchDeckConfigById here.
            await switchPreset(created.id);
            creatingPreset = false;
            newPresetName = "";
        } catch (e) {
            errorCreatePreset =
                e instanceof Error ? e.message : "Failed to create preset";
        } finally {
            savingCreatePreset = false;
        }
    }

    function cancelCreatePreset(): void {
        creatingPreset = false;
        newPresetName = "";
        errorCreatePreset = null;
    }

    async function deletePreset(id: number, name: string): Promise<void> {
        // Two-step delete: native confirm() keeps the dependency surface
        // minimal — no modal component, no focus-trap to maintain. The
        // copy includes the preset name so a slip on the dropdown
        // doesn't take out the wrong preset.
        if (
            typeof window !== "undefined" &&
            !window.confirm(
                `Delete preset "${name}"? Decks using it will fall back to Default.`,
            )
        ) {
            return;
        }
        deletingPreset = true;
        errorDeletePreset = null;
        try {
            await deleteDeckConfig(id);
            // Drop the deleted row from the local list and pick a successor
            // — Default if it survives, else the first remaining preset.
            // Server-side delete already reassigned orphan decks to Default
            // so we don't have to refetch /api/decks.
            presets = presets.filter((p) => p.id !== id);
            const successor =
                presets.find((p) => p.id === DEFAULT_PRESET_ID) ?? presets[0];
            if (successor) {
                // selectedPresetId may be the just-deleted id; clear first
                // so switchPreset's short-circuit doesn't see a stale match.
                selectedPresetId = null;
                await switchPreset(successor.id);
            } else {
                selectedPresetId = null;
            }
        } catch (e) {
            errorDeletePreset =
                e instanceof Error ? e.message : "Failed to delete preset";
        } finally {
            deletingPreset = false;
        }
    }

    async function switchPreset(nextId: number): Promise<void> {
        if (nextId === selectedPresetId) return;
        switchingPreset = true;
        errorRetention = null;
        errorMaxInterval = null;
        errorOptimize = null;
        try {
            const conf = await fetchDeckConfigById(nextId);
            selectedPresetId = nextId;
            applyPresetSnapshot(conf);
        } catch (e) {
            // Stay on the previous preset; surface the failure inline so the
            // user knows the dropdown's apparent state did not take effect.
            errorOptimize =
                e instanceof Error ? e.message : "Failed to load preset";
        } finally {
            switchingPreset = false;
        }
    }

    async function persistRetention(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingRetention = true;
        errorRetention = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                desired_retention: retentionPct / 100,
            });
            retentionPct = Math.round(next.desired_retention * 100);
        } catch (e) {
            errorRetention =
                e instanceof Error ? e.message : "Failed to save retention";
        } finally {
            savingRetention = false;
        }
    }

    async function persistMaxInterval(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingMaxInterval = true;
        errorMaxInterval = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                maximum_review_interval: maxInterval,
            });
            maxInterval = next.maximum_review_interval;
        } catch (e) {
            errorMaxInterval =
                e instanceof Error ? e.message : "Failed to save interval";
        } finally {
            savingMaxInterval = false;
        }
    }

    async function persistNewPerDay(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingNewPerDay = true;
        errorNewPerDay = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                new_per_day: newPerDay,
            });
            newPerDay = next.new_per_day;
        } catch (e) {
            errorNewPerDay =
                e instanceof Error ? e.message : "Failed to save new-per-day";
        } finally {
            savingNewPerDay = false;
        }
    }

    async function persistReviewsPerDay(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingReviewsPerDay = true;
        errorReviewsPerDay = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                reviews_per_day: reviewsPerDay,
            });
            reviewsPerDay = next.reviews_per_day;
        } catch (e) {
            errorReviewsPerDay =
                e instanceof Error ? e.message : "Failed to save reviews-per-day";
        } finally {
            savingReviewsPerDay = false;
        }
    }

    async function persistCapAnswerTime(): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        savingCapAnswerTime = true;
        errorCapAnswerTime = null;
        try {
            const next = await patchDeckConfigById(selectedPresetId, {
                cap_answer_time_secs: capAnswerTimeSecs,
            });
            capAnswerTimeSecs = next.cap_answer_time_secs;
        } catch (e) {
            errorCapAnswerTime =
                e instanceof Error ? e.message : "Failed to save answer-time cap";
        } finally {
            savingCapAnswerTime = false;
        }
    }

    async function persistNewCardOrder(next: "due" | "random"): Promise<void> {
        if (disabledControls() || selectedPresetId === null) return;
        if (next === newCardOrder) return;
        const previous = newCardOrder;
        // Optimistic update so the segmented control highlights the new
        // option immediately. Roll back on failure — the same
        // fail-then-rollback shape as switchPreset.
        newCardOrder = next;
        savingNewCardOrder = true;
        errorNewCardOrder = null;
        try {
            const conf = await patchDeckConfigById(selectedPresetId, {
                new_card_order: next,
            });
            newCardOrder = conf.new_card_order;
        } catch (e) {
            newCardOrder = previous;
            errorNewCardOrder =
                e instanceof Error ? e.message : "Failed to save new-card order";
        } finally {
            savingNewCardOrder = false;
        }
    }

    async function persistFsrs(): Promise<void> {
        if (disabledControls()) return;
        savingFsrs = true;
        errorFsrs = null;
        try {
            const next = await putFsrsEnabled({ enabled: fsrsEnabled });
            fsrsEnabled = next.enabled;
        } catch (e) {
            errorFsrs = e instanceof Error ? e.message : "Failed to save FSRS toggle";
        } finally {
            savingFsrs = false;
        }
    }

    async function persistHealthCheck(): Promise<void> {
        if (disabledControls()) return;
        savingHealthCheck = true;
        errorHealthCheck = null;
        try {
            const next = await putFsrsHealthCheck({ enabled: fsrsHealthCheck });
            fsrsHealthCheck = next.enabled;
        } catch (e) {
            // Roll back the optimistic checkbox flip so the UI reflects
            // the still-persisted-server state — same recovery shape as
            // persistFsrs, just no reschedule cost on failure.
            fsrsHealthCheck = !fsrsHealthCheck;
            errorHealthCheck =
                e instanceof Error
                    ? e.message
                    : "Failed to save FSRS health-check toggle";
        } finally {
            savingHealthCheck = false;
        }
    }

    // Phase 16-B: lazy-load notetypes on first switch to the tab so we
    // don't pay the round-trip on every Settings open. Idempotent — the
    // notetypes != null guard makes a re-click a no-op until either the
    // user renames something or hits an error.
    async function ensureNotetypesLoaded(): Promise<void> {
        if (notetypes !== null || loadingNotetypes) return;
        loadingNotetypes = true;
        errorNotetypesLoad = null;
        try {
            const res = await fetchNotetypes();
            notetypes = res.notetypes;
        } catch (e) {
            errorNotetypesLoad =
                e instanceof Error ? e.message : "Couldn't load notetypes";
        } finally {
            loadingNotetypes = false;
        }
    }

    function startEditNotetype(id: number, name: string): void {
        editingNotetypeId = id;
        notetypeNameDraft = name;
        errorNotetypeRename = null;
    }

    function cancelEditNotetype(): void {
        editingNotetypeId = null;
        notetypeNameDraft = "";
        errorNotetypeRename = null;
    }

    async function commitEditNotetype(): Promise<void> {
        if (editingNotetypeId === null || !notetypes) return;
        const trimmed = notetypeNameDraft.trim();
        const original = notetypes.find((n) => n.id === editingNotetypeId);
        if (!original) {
            cancelEditNotetype();
            return;
        }
        if (trimmed === "" || trimmed === original.name) {
            cancelEditNotetype();
            return;
        }
        savingNotetypeRename = true;
        errorNotetypeRename = null;
        try {
            const res = await patchNotetypeName(editingNotetypeId, trimmed);
            // Mirror the server-canonical name into local state so a
            // follow-up view doesn't need a refetch.
            notetypes = notetypes.map((n) =>
                n.id === res.id ? { ...n, name: res.name } : n,
            );
            editingNotetypeId = null;
            notetypeNameDraft = "";
        } catch (e) {
            errorNotetypeRename =
                e instanceof Error ? e.message : "Rename failed";
        } finally {
            savingNotetypeRename = false;
        }
    }

    // Phase 19-B: notetype field expansion + add. Expansion just toggles
    // visibility of the fields list; lazy-load isn't needed because
    // `notetypes` already carries `fields: string[]` on every row.
    function toggleNotetypeExpanded(id: number): void {
        expandedNotetypeId = expandedNotetypeId === id ? null : id;
        // Closing the expansion also closes the +New field form to
        // avoid abandoned drafts. Errors clear with the form so the
        // re-open shows a fresh state.
        if (expandedNotetypeId === null) {
            addingFieldNotetypeId = null;
            newFieldNameDraft = "";
            errorAddField = null;
        }
    }

    function startAddField(id: number): void {
        addingFieldNotetypeId = id;
        newFieldNameDraft = "";
        errorAddField = null;
    }

    function cancelAddField(): void {
        addingFieldNotetypeId = null;
        newFieldNameDraft = "";
        errorAddField = null;
    }

    function startDeleteField(ntId: number, ord: number): void {
        pendingDelete = { ntId, ord };
        errorDeleteField = null;
    }

    function cancelDeleteField(): void {
        pendingDelete = null;
        errorDeleteField = null;
    }

    /**
     * Phase 19-C: confirm the pending delete and call the destructive
     * endpoint. Two-step gate (the inline Confirm/Cancel pair) replaces
     * a `window.confirm` dialog — keeps the flow on the page so the
     * field name is still visible while the user makes the call. Server
     * returns the canonical post-write detail; we mirror just `fields`
     * back into local state to keep the slim picker shape unchanged.
     */
    async function commitDeleteField(): Promise<void> {
        if (!pendingDelete || !notetypes) return;
        const { ntId, ord } = pendingDelete;
        savingDeleteField = true;
        errorDeleteField = null;
        try {
            const res = await deleteNotetypeField(ntId, ord);
            notetypes = notetypes.map((n) =>
                n.id === res.id ? { ...n, fields: res.fields } : n,
            );
            pendingDelete = null;
        } catch (e) {
            errorDeleteField = {
                id: ntId,
                message: e instanceof Error ? e.message : "Delete field failed",
            };
        } finally {
            savingDeleteField = false;
        }
    }

    async function commitAddField(): Promise<void> {
        if (addingFieldNotetypeId === null || !notetypes) return;
        const trimmed = newFieldNameDraft.trim();
        if (trimmed === "") {
            errorAddField = {
                id: addingFieldNotetypeId,
                message: "name must not be empty",
            };
            return;
        }
        const targetId = addingFieldNotetypeId;
        savingNewField = true;
        errorAddField = null;
        try {
            const res = await postNotetypeField(targetId, trimmed);
            // Server returns the canonical post-write notetype detail
            // including the appended field. Mirror just the fields
            // array into local state — preserving the picker's slim
            // ApiNotetypeSummary shape in `notetypes` keeps unrelated
            // tabs from re-rendering with extra payload.
            notetypes = notetypes.map((n) =>
                n.id === res.id ? { ...n, fields: res.fields } : n,
            );
            addingFieldNotetypeId = null;
            newFieldNameDraft = "";
        } catch (e) {
            errorAddField = {
                id: targetId,
                message: e instanceof Error ? e.message : "Add field failed",
            };
        } finally {
            savingNewField = false;
        }
    }

    // Reactively trigger the lazy load when the user switches to the
    // notetypes tab. $effect rather than onclick on the nav-item so the
    // loader runs even if the tab is reached via deep-link or keyboard
    // navigation (future iterations).
    $effect(() => {
        if (active === "notetypes") {
            ensureNotetypesLoaded();
        }
    });

    /**
     * Phase 20-C: look up the card for the id currently in the input.
     * Validates positive-integer parsing client-side so a typo'd "abc"
     * shows an inline error instead of round-tripping. Server 404s
     * (missing card) surface via the standard `${status} ${message}`
     * shape the jsonRequest helper produces — `getCard` uses `getJson`
     * which throws `${status} ${statusText}` on 4xx, so we surface
     * that text directly into errorRecoveryLookup.
     */
    async function lookupRecoveryCard(): Promise<void> {
        const trimmed = recoveryCardIdInput.trim();
        const parsed = Number(trimmed);
        if (!trimmed || !Number.isInteger(parsed) || parsed <= 0) {
            errorRecoveryLookup = "Card id must be a positive integer";
            recoveryCard = null;
            return;
        }
        lookingUpCard = true;
        errorRecoveryLookup = null;
        recoverySuccess = null;
        // Cancel any half-armed confirm so the lookup result lands in a
        // clean state — a fresh card preview should never inherit the
        // previous card's "Confirm/Cancel pending" UI.
        pendingRecoveryReset = false;
        try {
            recoveryCard = await getCard(parsed);
        } catch (e) {
            recoveryCard = null;
            errorRecoveryLookup = e instanceof Error
                ? e.message
                : "Lookup failed";
        } finally {
            lookingUpCard = false;
        }
    }

    function startRecoveryReset(): void {
        if (!recoveryCard) return;
        pendingRecoveryReset = true;
        errorRecoveryReset = null;
        recoverySuccess = null;
    }

    function cancelRecoveryReset(): void {
        pendingRecoveryReset = false;
        errorRecoveryReset = null;
    }

    /**
     * Phase 20-C: commit the destructive reset. Mirrors commitDeleteField
     * (19-C) — server returns the canonical post-write payload; success
     * surfaces a single-line confirmation that includes the preserved
     * revlog count so the user has explicit evidence history wasn't
     * dropped. On success the form clears (id input + card preview)
     * so the next recovery starts from scratch; on failure the form
     * stays put so the user can retry without re-typing.
     */
    async function commitRecoveryReset(): Promise<void> {
        if (!recoveryCard) return;
        const targetId = recoveryCard.id;
        savingRecoveryReset = true;
        errorRecoveryReset = null;
        try {
            const res = await resetCardToNew(targetId);
            recoverySuccess =
                `Reset. State now: ${res.state}. ${res.revlog_preserved} revlog entries preserved.`;
            recoveryCard = null;
            recoveryCardIdInput = "";
            pendingRecoveryReset = false;
        } catch (e) {
            errorRecoveryReset = e instanceof Error
                ? e.message
                : "Reset failed";
        } finally {
            savingRecoveryReset = false;
        }
    }

    async function runOptimize(): Promise<void> {
        if (disabledControls() || optimizing) return;
        if (selectedPresetId === null) return;
        optimizing = true;
        errorOptimize = null;
        try {
            // Phase 14-B: pass the active preset id so server trains
            // only on cards in decks assigned to that preset. Default
            // preset (id=1) still has implicit-inheritance fallback,
            // but we send its id explicitly so the per-preset path is
            // exercised uniformly — server preflight will surface a
            // useful 400 if a fresh non-Default preset has no decks.
            const res = await postFsrsOptimize(selectedPresetId);
            optimizeFsrsItems = res.fsrs_items;
            optimizedParams = res.params;
            paramsSource = "fresh";
        } catch (e) {
            errorOptimize =
                e instanceof Error ? e.message : "Failed to optimize FSRS params";
        } finally {
            optimizing = false;
        }
    }
</script>

<svelte:head><title>Settings — Anki</title></svelte:head>

<div class="sketch-skin grain page tx-page" data-testid="settings-root">
    <header class="tx-head" data-testid="settings-hero">
        <div class="tx-head-left">
            <Caption>// settings</Caption>
            <h1 class="tx-title mono" data-testid="settings-title">
                preferences
                <span class="tx-title-hand hand" aria-hidden="true">tune your tools</span>
            </h1>
            <p class="tx-subtitle mono">
                configure how this collection behaves
                <span class="tx-subtitle-kbd mono">data layer wired live</span>
            </p>
        </div>
        <div class="tx-head-right" aria-hidden="true">
            <SketchGear size={56} />
        </div>
    </header>

    <section class="tx-shell" data-testid="settings-shell">
        <aside class="tx-sidebar" data-testid="settings-sidebar">
            <div class="tx-sidebar-block">
                <Caption>// sections</Caption>
                <nav class="tx-nav" aria-label="Settings sections">
                    {#each sections as s (s.id)}
                        <button
                            type="button"
                            class="tx-nav-item mono"
                            class:tx-nav-item-active={active === s.id}
                            data-testid="settings-nav-{s.id}"
                            aria-current={active === s.id ? "page" : undefined}
                            onclick={() => (active = s.id)}
                        >
                            <span class="tx-nav-icon" aria-hidden="true">
                                {#if s.id === "profile"}
                                    <SketchUser size={13} />
                                {:else if s.id === "scheduling"}
                                    <SketchClock size={13} />
                                {:else if s.id === "fsrs"}
                                    <SketchSpark size={13} />
                                {:else if s.id === "notetypes"}
                                    <SketchCardStack size={13} />
                                {:else if s.id === "recovery"}
                                    <SketchFlame size={13} />
                                {:else if s.id === "sync"}
                                    <SketchGlobe size={13} />
                                {:else if s.id === "appearance"}
                                    <SketchLeaf size={13} />
                                {:else if s.id === "advanced"}
                                    <SketchLock size={13} />
                                {:else if s.id === "admin"}
                                    <SketchUser size={13} />
                                {/if}
                            </span>
                            <span class="tx-nav-label">{s.label.toLowerCase()}</span>
                        </button>
                    {/each}
                </nav>
            </div>

            <div class="tx-sidebar-block tx-sidebar-account" data-testid="settings-account-block">
                <Caption>// account</Caption>
                {#if auth.user}
                    <div class="tx-account-row mono" data-testid="settings-account-row">
                        <span class="tx-account-icon" aria-hidden="true">
                            <SketchUser size={12} />
                        </span>
                        <span class="tx-account-name" data-testid="settings-account-name">
                            {auth.user.username}
                        </span>
                    </div>
                    <button
                        type="button"
                        class="tx-logout-btn mono"
                        data-testid="settings-logout-btn"
                        onclick={() => auth.logout()}
                    >
                        logout
                    </button>
                    {#if pwSuccess}
                        <p
                            class="tx-account-msg tx-account-msg-ok mono"
                            data-testid="settings-pw-success"
                            role="status"
                        >
                            // password updated
                        </p>
                    {/if}
                    {#if !pwOpen}
                        <button
                            type="button"
                            class="tx-account-link mono"
                            data-testid="settings-pw-toggle"
                            onclick={togglePwOpen}
                        >
                            change password →
                        </button>
                    {:else}
                        <form
                            class="tx-pw-form"
                            data-testid="settings-pw-form"
                            onsubmit={submitPasswordChange}
                        >
                            <label class="tx-pw-field mono">
                                <span class="tx-pw-label">current</span>
                                <input
                                    type="password"
                                    autocomplete="current-password"
                                    bind:value={pwCurrent}
                                    data-testid="settings-pw-current"
                                    disabled={pwSaving}
                                />
                            </label>
                            <label class="tx-pw-field mono">
                                <span class="tx-pw-label">new</span>
                                <input
                                    type="password"
                                    autocomplete="new-password"
                                    bind:value={pwNew}
                                    data-testid="settings-pw-new"
                                    disabled={pwSaving}
                                />
                            </label>
                            <label class="tx-pw-field mono">
                                <span class="tx-pw-label">confirm</span>
                                <input
                                    type="password"
                                    autocomplete="new-password"
                                    bind:value={pwConfirm}
                                    data-testid="settings-pw-confirm"
                                    disabled={pwSaving}
                                />
                            </label>
                            {#if pwError}
                                <p
                                    class="tx-account-msg tx-account-msg-err mono"
                                    data-testid="settings-pw-error"
                                    role="alert"
                                >
                                    {pwError}
                                </p>
                            {/if}
                            <div class="tx-pw-actions mono">
                                <button
                                    type="submit"
                                    class="tx-pw-submit"
                                    data-testid="settings-pw-submit"
                                    disabled={pwSaving}
                                >
                                    {pwSaving ? "saving…" : "save"}
                                </button>
                                <button
                                    type="button"
                                    class="tx-pw-cancel"
                                    data-testid="settings-pw-cancel"
                                    onclick={togglePwOpen}
                                    disabled={pwSaving}
                                >
                                    cancel
                                </button>
                            </div>
                        </form>
                    {/if}
                {:else}
                    <div class="tx-account-row mono">
                        <span class="tx-account-name">— not signed in</span>
                    </div>
                {/if}
            </div>

            <div class="tx-sidebar-block tx-sidebar-build">
                <Caption>// build</Caption>
                <div class="tx-build mono">
                    <div>ferdinand</div>
                    <div class="tx-build-mute">phase A4-ε₂</div>
                    <div class="tx-build-ok">sketch-skin ✓</div>
                </div>
            </div>
        </aside>

        <div class="tx-panel" data-testid="settings-panel">
            <header class="tx-panel-head">
                <Caption>// {active}.config</Caption>
                <h2 class="tx-panel-title mono" data-testid="settings-panel-title">
                    {sections.find((s) => s.id === active)?.label.toLowerCase() ?? ""}
                    {#if active === "fsrs"}
                        <span class="tx-panel-hand hand" aria-hidden="true">tune the scheduler</span>
                    {:else if active === "appearance"}
                        <span class="tx-panel-hand hand" aria-hidden="true">paper or ink</span>
                    {:else if active === "sync"}
                        <span class="tx-panel-hand hand" aria-hidden="true">your collection, your server</span>
                    {:else if active === "notetypes"}
                        <span class="tx-panel-hand hand" aria-hidden="true">card templates</span>
                    {:else if active === "recovery"}
                        <span class="tx-panel-hand hand" aria-hidden="true">undo a slip</span>
                    {:else if active === "admin"}
                        <span class="tx-panel-hand hand" aria-hidden="true">manage users</span>
                    {/if}
                </h2>
                <p class="tx-panel-sub mono">
                    {#if active === "fsrs"}
                        tune fsrs v5 to match your memory
                    {:else if active === "appearance"}
                        cream paper or warm dark
                    {:else if active === "notetypes"}
                        rename templates and manage their fields
                    {:else if active === "recovery"}
                        reset a card's schedule when a rating slips
                    {:else if active === "sync"}
                        m4 self-hosted server preview
                    {:else if active === "admin"}
                        list users · disable accounts · force-reset passwords
                    {:else}
                        configure how this collection behaves
                    {/if}
                </p>
            </header>

            {#if active === "fsrs"}
                {#if loadError}
                    <div class="tx-banner tx-banner-error mono" role="alert" data-testid="settings-load-error">
                        // couldn't reach anki server — settings shown are unsaved defaults until reconnected
                        <div class="tx-banner-detail">{loadError}</div>
                    </div>
                {/if}
                <p class="tx-disclaimer mono">
                    // editing presets directly. per-deck assignment lands in a later release.
                </p>

                {#if presets.length > 0}
                    <div class="tx-card tx-preset-card" data-testid="settings-preset-card">
                        <div class="tx-card-head">
                            <Caption>// preset</Caption>
                            <span class="tx-card-hand hand" aria-hidden="true">scheduling profile</span>
                        </div>
                        <div class="tx-preset-row">
                            <label for="preset-select" class="tx-label mono">active</label>
                            <div class="tx-select-wrap">
                                <select
                                    id="preset-select"
                                    class="tx-select mono"
                                    value={selectedPresetId}
                                    onchange={(e) => {
                                        const next = Number((e.target as HTMLSelectElement).value);
                                        if (!Number.isNaN(next)) switchPreset(next);
                                    }}
                                    disabled={loading || loadError !== null || switchingPreset}
                                    data-testid="settings-preset-select"
                                >
                                    {#each presets as p (p.id)}
                                        <option value={p.id}>{p.name}</option>
                                    {/each}
                                </select>
                                <span class="tx-select-caret mono" aria-hidden="true">▾</span>
                            </div>
                            {#if switchingPreset}
                                <span class="tx-saving mono">loading…</span>
                            {/if}
                            {#if !creatingPreset}
                                <button
                                    type="button"
                                    class="tx-btn tx-btn-paper mono"
                                    onclick={() => {
                                        creatingPreset = true;
                                        newPresetName = "";
                                        errorCreatePreset = null;
                                    }}
                                    disabled={disabledControls() || switchingPreset}
                                    data-testid="settings-new-preset-btn"
                                >
                                    <SketchPlus size={11} />
                                    <span>new preset</span>
                                </button>
                            {/if}
                            {#if !creatingPreset && selectedPresetId !== null && selectedPresetId !== DEFAULT_PRESET_ID}
                                {@const sel = presets.find(
                                    (p) => p.id === selectedPresetId,
                                )}
                                {#if sel}
                                    <button
                                        type="button"
                                        class="tx-btn tx-btn-danger mono"
                                        onclick={() => deletePreset(sel.id, sel.name)}
                                        disabled={disabledControls() ||
                                            switchingPreset ||
                                            deletingPreset}
                                        data-testid="settings-delete-preset-btn"
                                    >
                                        delete
                                    </button>
                                {/if}
                            {/if}
                            {#if deletingPreset}
                                <span class="tx-saving mono">deleting…</span>
                            {/if}
                            {#if errorDeletePreset}
                                <span class="tx-error mono" role="alert">{errorDeletePreset}</span>
                            {/if}
                        </div>
                        {#if creatingPreset}
                            <div class="tx-create-preset-row">
                                <label for="new-preset-name" class="tx-label mono">name</label>
                                <input
                                    id="new-preset-name"
                                    type="text"
                                    class="tx-input mono"
                                    bind:value={newPresetName}
                                    disabled={savingCreatePreset}
                                    maxlength="100"
                                    placeholder="e.g. Languages"
                                />
                                <button
                                    type="button"
                                    class="tx-btn tx-btn-primary mono"
                                    onclick={createPreset}
                                    disabled={savingCreatePreset ||
                                        newPresetName.trim() === ""}
                                >
                                    <SketchCheck size={11} />
                                    <span>save</span>
                                </button>
                                <button
                                    type="button"
                                    class="tx-btn tx-btn-ghost mono"
                                    onclick={cancelCreatePreset}
                                    disabled={savingCreatePreset}
                                >
                                    cancel
                                </button>
                                {#if savingCreatePreset}
                                    <span class="tx-saving mono">creating…</span>
                                {/if}
                                {#if errorCreatePreset}
                                    <span class="tx-error mono" role="alert">{errorCreatePreset}</span>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}

                <div class="tx-card" data-testid="settings-fsrs-fields-card">
                    <div class="tx-card-head">
                        <Caption>// scheduling</Caption>
                        <span class="tx-card-hand hand" aria-hidden="true">caps and cadence</span>
                    </div>

                    <div class="tx-field">
                        <div class="tx-field-head">
                            <div class="tx-field-meta">
                                <label for="fsrs-enabled" class="tx-label mono">enable fsrs</label>
                                <p class="tx-hint mono">
                                    use the fsrs v5 scheduler. toggling reschedules existing
                                    cards under current params — may take a few seconds on
                                    large collections.
                                </p>
                            </div>
                            <div class="tx-toggle-cell">
                                {#if savingFsrs}
                                    <span class="tx-saving mono">rescheduling…</span>
                                {/if}
                                <input
                                    id="fsrs-enabled"
                                    type="checkbox"
                                    class="tx-checkbox"
                                    bind:checked={fsrsEnabled}
                                    onchange={() => persistFsrs()}
                                    disabled={disabledControls()}
                                />
                            </div>
                        </div>
                        {#if errorFsrs}
                            <p class="tx-error mono">{errorFsrs}</p>
                        {/if}
                    </div>

                    <div class="tx-field">
                        <div class="tx-field-head">
                            <div class="tx-field-meta">
                                <label for="desired-retention" class="tx-label mono">desired retention</label>
                                <p class="tx-hint mono">target probability of recalling a card when due.</p>
                            </div>
                            <div class="tx-value-pill mono">{retentionPct}%</div>
                        </div>
                        <input
                            id="desired-retention"
                            type="range"
                            class="tx-range"
                            min="70"
                            max="97"
                            bind:value={retentionPct}
                            onchange={() => persistRetention()}
                            disabled={disabledControls()}
                        />
                        <div class="tx-scale mono">
                            <span>70%</span>
                            <span>85%</span>
                            <span>97%</span>
                        </div>
                        {#if savingRetention}
                            <span class="tx-saving mono">saving…</span>
                        {/if}
                        {#if errorRetention}
                            <p class="tx-error mono">{errorRetention}</p>
                        {/if}
                    </div>

                    <div class="tx-field">
                        <div class="tx-field-head">
                            <div class="tx-field-meta">
                                <label for="max-interval" class="tx-label mono">maximum interval</label>
                                <p class="tx-hint mono">cap in days. longer = fewer reviews but slower learning.</p>
                            </div>
                            <input
                                id="max-interval"
                                class="tx-num-input mono"
                                type="number"
                                min="1"
                                max="36500"
                                bind:value={maxInterval}
                                onblur={() => persistMaxInterval()}
                                disabled={disabledControls()}
                            />
                        </div>
                        {#if savingMaxInterval}
                            <span class="tx-saving mono">saving…</span>
                        {/if}
                        {#if errorMaxInterval}
                            <p class="tx-error mono">{errorMaxInterval}</p>
                        {/if}
                    </div>

                    <div class="tx-field">
                        <div class="tx-field-head">
                            <div class="tx-field-meta">
                                <label for="new-per-day" class="tx-label mono">new cards per day</label>
                                <p class="tx-hint mono">daily cap on newly-introduced cards. 0 pauses new cards.</p>
                            </div>
                            <input
                                id="new-per-day"
                                class="tx-num-input mono"
                                type="number"
                                min="0"
                                max="9999"
                                bind:value={newPerDay}
                                onblur={() => persistNewPerDay()}
                                disabled={disabledControls()}
                            />
                        </div>
                        {#if savingNewPerDay}
                            <span class="tx-saving mono">saving…</span>
                        {/if}
                        {#if errorNewPerDay}
                            <p class="tx-error mono">{errorNewPerDay}</p>
                        {/if}
                    </div>

                    <div class="tx-field">
                        <div class="tx-field-head">
                            <div class="tx-field-meta">
                                <label for="reviews-per-day" class="tx-label mono">reviews per day</label>
                                <p class="tx-hint mono">daily cap on review cards. 0 pauses reviews.</p>
                            </div>
                            <input
                                id="reviews-per-day"
                                class="tx-num-input mono"
                                type="number"
                                min="0"
                                max="9999"
                                bind:value={reviewsPerDay}
                                onblur={() => persistReviewsPerDay()}
                                disabled={disabledControls()}
                            />
                        </div>
                        {#if savingReviewsPerDay}
                            <span class="tx-saving mono">saving…</span>
                        {/if}
                        {#if errorReviewsPerDay}
                            <p class="tx-error mono">{errorReviewsPerDay}</p>
                        {/if}
                    </div>

                    <div class="tx-field">
                        <div class="tx-field-head">
                            <div class="tx-field-meta">
                                <label for="cap-answer-time" class="tx-label mono">answer-time cap</label>
                                <p class="tx-hint mono">soft per-card timer in seconds. slower than this counts as a hard answer.</p>
                            </div>
                            <input
                                id="cap-answer-time"
                                class="tx-num-input mono"
                                type="number"
                                min="1"
                                max="600"
                                bind:value={capAnswerTimeSecs}
                                onblur={() => persistCapAnswerTime()}
                                disabled={disabledControls()}
                            />
                        </div>
                        {#if savingCapAnswerTime}
                            <span class="tx-saving mono">saving…</span>
                        {/if}
                        {#if errorCapAnswerTime}
                            <p class="tx-error mono">{errorCapAnswerTime}</p>
                        {/if}
                    </div>

                    <div class="tx-field tx-field-last">
                        <div class="tx-field-head">
                            <div class="tx-field-meta">
                                <!-- svelte-ignore a11y_label_has_associated_control: this label is the ARIA group label for the radiogroup below via aria-labelledby, not bound to a single input -->
                                <label id="new-card-order-label" class="tx-label mono">new card order</label>
                                <p class="tx-hint mono">order new cards are picked off the daily pool. random shuffles within the per-day cap.</p>
                            </div>
                            <div
                                class="tx-segmented mono"
                                role="radiogroup"
                                aria-labelledby="new-card-order-label"
                            >
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={newCardOrder === "due"}
                                    class="tx-segment"
                                    class:tx-segment-active={newCardOrder === "due"}
                                    onclick={() => persistNewCardOrder("due")}
                                    disabled={disabledControls() || savingNewCardOrder}
                                >due</button>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={newCardOrder === "random"}
                                    class="tx-segment"
                                    class:tx-segment-active={newCardOrder === "random"}
                                    onclick={() => persistNewCardOrder("random")}
                                    disabled={disabledControls() || savingNewCardOrder}
                                >random</button>
                            </div>
                        </div>
                        {#if savingNewCardOrder}
                            <span class="tx-saving mono">saving…</span>
                        {/if}
                        {#if errorNewCardOrder}
                            <p class="tx-error mono">{errorNewCardOrder}</p>
                        {/if}
                    </div>
                </div>

                <div class="tx-card" data-testid="settings-optimize-card">
                    <div class="tx-card-head">
                        <Caption>// optimize</Caption>
                        <span class="tx-card-hand hand" aria-hidden="true">trained weights</span>
                    </div>
                    <div class="tx-optimize-actions">
                        <label class="tx-health-toggle mono" title="Verify trained params on next optimize / enable-flip">
                            <input
                                type="checkbox"
                                class="tx-checkbox"
                                bind:checked={fsrsHealthCheck}
                                disabled={disabledControls() || savingHealthCheck}
                                onchange={() => persistHealthCheck()}
                            />
                            <span>health check</span>
                        </label>
                        <button
                            type="button"
                            class="tx-btn tx-btn-paper mono"
                            onclick={() => runOptimize()}
                            disabled={disabledControls() || optimizing}
                            data-testid="settings-reoptimize-btn"
                        >
                            {optimizing ? "optimizing…" : "re-optimize"}
                        </button>
                    </div>
                    {#if errorHealthCheck}
                        <p class="tx-error mono">{errorHealthCheck}</p>
                    {/if}
                    <p class="tx-hint mono">
                        {#if paramsSource === "disk"}
                            loaded {optimizedParams.length} params from disk · click
                            re-optimize to retrain on the latest review history.
                        {:else if optimizeFsrsItems === null}
                            click re-optimize to fit fsrs parameters from your
                            review history.
                        {:else if optimizeFsrsItems === 0}
                            no reviews available yet — log some reviews first, then
                            re-optimize.
                        {:else}
                            trained on {optimizeFsrsItems.toLocaleString()} reviews
                            on {presets.find((p) => p.id === selectedPresetId)
                                ?.name ?? "this preset"} · params updated.
                        {/if}
                    </p>
                    {#if errorOptimize}
                        <p class="tx-error mono">{errorOptimize}</p>
                    {/if}
                    {#if optimizedParams.length > 0}
                        <div class="tx-weights">
                            {#each optimizedParams as w, i (i)}
                                <div class="tx-w-cell">
                                    <div class="tx-w-i mono">w<sub>{i}</sub></div>
                                    <div class="tx-w-v mono">{w.toFixed(3)}</div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {:else if active === "appearance"}
                <div class="tx-card" data-testid="settings-theme-card">
                    <div class="tx-card-head">
                        <Caption>// theme</Caption>
                        <span class="tx-card-hand hand" aria-hidden="true">paper or ink</span>
                    </div>
                    <p class="tx-hint mono">
                        light uses a warm cream base; dark is a deep warm gray.
                    </p>
                    <div class="tx-theme-grid">
                        <label class="tx-theme-opt" data-testid="settings-theme-light">
                            <input
                                type="radio"
                                name="theme"
                                value="light"
                                bind:group={themeChoice}
                                onchange={() => setThemeChoice("light")}
                            />
                            <div class="tx-theme-swatch tx-theme-swatch-light" aria-hidden="true"></div>
                            <span class="mono">light</span>
                        </label>
                        <label class="tx-theme-opt" data-testid="settings-theme-dark">
                            <input
                                type="radio"
                                name="theme"
                                value="dark"
                                bind:group={themeChoice}
                                onchange={() => setThemeChoice("dark")}
                            />
                            <div class="tx-theme-swatch tx-theme-swatch-dark" aria-hidden="true"></div>
                            <span class="mono">dark</span>
                        </label>
                        <label class="tx-theme-opt" data-testid="settings-theme-auto">
                            <input
                                type="radio"
                                name="theme"
                                value="auto"
                                bind:group={themeChoice}
                                onchange={() => setThemeChoice("auto")}
                            />
                            <div class="tx-theme-swatch tx-theme-swatch-auto" aria-hidden="true"></div>
                            <span class="mono">system</span>
                        </label>
                    </div>
                </div>
            {:else if active === "notetypes"}
                <div class="tx-card" data-testid="settings-notetypes-card">
                    <div class="tx-card-head">
                        <Caption>// notetypes</Caption>
                        <span class="tx-card-hand hand" aria-hidden="true">card templates</span>
                    </div>
                    <p class="tx-hint mono">
                        rename the templates that drive your cards and manage
                        their fields. field changes affect every note sharing
                        the notetype, so expand a row before editing.
                    </p>
                    {#if loadingNotetypes}
                        <p class="tx-hint mono">loading notetypes…</p>
                    {:else if errorNotetypesLoad}
                        <p class="tx-error mono" role="alert">
                            {errorNotetypesLoad}
                        </p>
                    {:else if notetypes && notetypes.length > 0}
                        <ul class="tx-nt-list">
                            {#each notetypes as nt (nt.id)}
                                {@const isExpanded =
                                    expandedNotetypeId === nt.id}
                                <li class="tx-nt-row">
                                    <div class="tx-nt-row-head">
                                        {#if editingNotetypeId === nt.id}
                                            <input
                                                class="tx-input tx-nt-input mono"
                                                type="text"
                                                bind:value={notetypeNameDraft}
                                                disabled={savingNotetypeRename}
                                                aria-label="Notetype name"
                                                onkeydown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        commitEditNotetype();
                                                    } else if (e.key === "Escape") {
                                                        cancelEditNotetype();
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                class="tx-btn tx-btn-ghost mono"
                                                onclick={commitEditNotetype}
                                                disabled={savingNotetypeRename}
                                            >
                                                {savingNotetypeRename
                                                    ? "saving…"
                                                    : "save"}
                                            </button>
                                            <button
                                                type="button"
                                                class="tx-btn tx-btn-ghost mono"
                                                onclick={cancelEditNotetype}
                                                disabled={savingNotetypeRename}
                                            >
                                                cancel
                                            </button>
                                        {:else}
                                            <button
                                                type="button"
                                                class="tx-nt-disclose"
                                                aria-expanded={isExpanded}
                                                aria-label="Toggle fields for {nt.name}"
                                                onclick={() =>
                                                    toggleNotetypeExpanded(
                                                        nt.id,
                                                    )}
                                            >
                                                <span
                                                    class="tx-nt-chev mono"
                                                    class:tx-nt-chev-open={isExpanded}
                                                    aria-hidden="true"
                                                >›</span>
                                                <span class="tx-nt-name mono">
                                                    {nt.name}
                                                </span>
                                            </button>
                                            <span class="tx-nt-meta mono">
                                                {nt.fields.length} field{nt
                                                    .fields.length === 1
                                                    ? ""
                                                    : "s"}
                                            </span>
                                            <button
                                                type="button"
                                                class="tx-btn tx-btn-ghost mono"
                                                onclick={() =>
                                                    startEditNotetype(
                                                        nt.id,
                                                        nt.name,
                                                    )}
                                            >
                                                rename
                                            </button>
                                        {/if}
                                    </div>
                                    {#if isExpanded}
                                        <div class="tx-nt-fields">
                                            <ul class="tx-nt-fields-list">
                                                {#each nt.fields as fieldName, idx (idx)}
                                                    {@const isPendingDelete =
                                                        pendingDelete?.ntId ===
                                                            nt.id &&
                                                        pendingDelete?.ord ===
                                                            idx}
                                                    {@const isLastField =
                                                        nt.fields.length <= 1}
                                                    <li class="tx-nt-field-row">
                                                        <span
                                                            class="tx-nt-field-ord mono"
                                                            >{idx + 1}.</span>
                                                        <span
                                                            class="tx-nt-field-name mono"
                                                            >{fieldName}</span>
                                                        {#if isPendingDelete}
                                                            <span
                                                                class="tx-nt-field-confirm mono"
                                                            >
                                                                delete field?
                                                            </span>
                                                            <button
                                                                type="button"
                                                                class="tx-btn tx-btn-danger mono"
                                                                disabled={savingDeleteField}
                                                                onclick={commitDeleteField}
                                                            >
                                                                {savingDeleteField
                                                                    ? "deleting…"
                                                                    : "confirm"}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                class="tx-btn tx-btn-ghost mono"
                                                                disabled={savingDeleteField}
                                                                onclick={cancelDeleteField}
                                                            >
                                                                cancel
                                                            </button>
                                                        {:else}
                                                            <button
                                                                type="button"
                                                                class="tx-nt-field-x"
                                                                aria-label="Delete field {fieldName}"
                                                                title={isLastField
                                                                    ? "A notetype must have at least one field"
                                                                    : `Delete ${fieldName}`}
                                                                disabled={isLastField ||
                                                                    pendingDelete !==
                                                                        null}
                                                                onclick={() =>
                                                                    startDeleteField(
                                                                        nt.id,
                                                                        idx,
                                                                    )}
                                                            >×</button>
                                                        {/if}
                                                    </li>
                                                {/each}
                                            </ul>
                                            {#if errorDeleteField &&
                                                errorDeleteField.id === nt.id}
                                                <p
                                                    class="tx-error mono"
                                                    role="alert"
                                                >
                                                    {errorDeleteField.message}
                                                </p>
                                            {/if}
                                            {#if addingFieldNotetypeId === nt.id}
                                                <div class="tx-nt-field-add">
                                                    <input
                                                        class="tx-input tx-nt-input mono"
                                                        type="text"
                                                        placeholder="new field name"
                                                        bind:value={newFieldNameDraft}
                                                        disabled={savingNewField}
                                                        aria-label="New field name for {nt.name}"
                                                        onkeydown={(e) => {
                                                            if (
                                                                e.key === "Enter"
                                                            ) {
                                                                e.preventDefault();
                                                                commitAddField();
                                                            } else if (
                                                                e.key === "Escape"
                                                            ) {
                                                                cancelAddField();
                                                            }
                                                        }}
                                                    />
                                                    <button
                                                        type="button"
                                                        class="tx-btn tx-btn-ghost mono"
                                                        onclick={commitAddField}
                                                        disabled={savingNewField}
                                                    >
                                                        {savingNewField
                                                            ? "adding…"
                                                            : "add"}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="tx-btn tx-btn-ghost mono"
                                                        onclick={cancelAddField}
                                                        disabled={savingNewField}
                                                    >
                                                        cancel
                                                    </button>
                                                </div>
                                            {:else}
                                                <button
                                                    type="button"
                                                    class="tx-btn tx-btn-ghost tx-nt-add-btn mono"
                                                    onclick={() =>
                                                        startAddField(nt.id)}
                                                >
                                                    <SketchPlus size={11} />
                                                    <span>new field</span>
                                                </button>
                                            {/if}
                                            {#if errorAddField &&
                                                errorAddField.id === nt.id}
                                                <p
                                                    class="tx-error mono"
                                                    role="alert"
                                                >
                                                    {errorAddField.message}
                                                </p>
                                            {/if}
                                        </div>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                        {#if errorNotetypeRename}
                            <p class="tx-error mono" role="alert">
                                {errorNotetypeRename}
                            </p>
                        {/if}
                    {:else if notetypes && notetypes.length === 0}
                        <p class="tx-hint mono">
                            no notetypes on this collection — add cards from
                            the home page to seed basic.
                        </p>
                    {/if}
                </div>
            {:else if active === "recovery"}
                <div class="tx-card" data-testid="settings-recovery-card">
                    <div class="tx-card-head">
                        <Caption>// recovery</Caption>
                        <span class="tx-card-hand hand" aria-hidden="true">undo a slip</span>
                    </div>
                    <p class="tx-hint mono">
                        reset a card's scheduling state back to new. revlog
                        history is preserved so you can review what happened.
                        use when an accidental rating has corrupted a card's
                        schedule.
                    </p>

                    <div class="tx-recovery-lookup">
                        <label for="recovery-card-id" class="tx-label mono">
                            card id
                        </label>
                        <div class="tx-recovery-lookup-row">
                            <input
                                id="recovery-card-id"
                                class="tx-input tx-recovery-input mono"
                                type="text"
                                inputmode="numeric"
                                pattern="[0-9]*"
                                placeholder="e.g. 1714234567890"
                                bind:value={recoveryCardIdInput}
                                disabled={lookingUpCard ||
                                    savingRecoveryReset}
                            />
                            <button
                                type="button"
                                class="tx-btn tx-btn-paper mono"
                                onclick={lookupRecoveryCard}
                                disabled={lookingUpCard ||
                                    savingRecoveryReset ||
                                    recoveryCardIdInput.trim() === ""}
                            >
                                {lookingUpCard ? "looking up…" : "look up"}
                            </button>
                        </div>
                        {#if errorRecoveryLookup}
                            <p
                                class="tx-error mono"
                                role="alert"
                                data-test="recovery-lookup-error"
                            >
                                {errorRecoveryLookup}
                            </p>
                        {/if}
                    </div>

                    {#if recoveryCard}
                        <div class="tx-recovery-detail">
                            <div class="tx-recovery-row">
                                <div class="tx-meta-key mono">front</div>
                                <div
                                    class="tx-recovery-front mono"
                                    data-test="recovery-card-front"
                                >
                                    {recoveryCard.front_html.length > 240
                                        ? recoveryCard.front_html.slice(
                                              0,
                                              240,
                                          ) + "…"
                                        : recoveryCard.front_html}
                                </div>
                            </div>
                            <div class="tx-recovery-row">
                                <div class="tx-meta-key mono">deck</div>
                                <div class="mono" data-test="recovery-card-deck">
                                    {recoveryCard.deck_name}
                                </div>
                            </div>
                            <div class="tx-recovery-row">
                                <div class="tx-meta-key mono">notetype</div>
                                <div class="mono" data-test="recovery-card-notetype">
                                    {recoveryCard.notetype_name}
                                </div>
                            </div>
                            <div class="tx-recovery-row">
                                <div class="tx-meta-key mono">current state</div>
                                <div class="mono" data-test="recovery-card-state">
                                    {recoveryCard.state}
                                </div>
                            </div>
                            <div class="tx-recovery-row">
                                <div class="tx-meta-key mono">ease factor</div>
                                <div class="mono" data-test="recovery-card-ease">
                                    {recoveryCard.ease_factor.toFixed(2)}
                                </div>
                            </div>
                            <div class="tx-recovery-row">
                                <div class="tx-meta-key mono">tags</div>
                                <div class="mono" data-test="recovery-card-tags">
                                    {recoveryCard.tags.length > 0
                                        ? recoveryCard.tags.join(", ")
                                        : "(none)"}
                                </div>
                            </div>

                            <div class="tx-recovery-actions">
                                {#if !pendingRecoveryReset}
                                    <button
                                        type="button"
                                        class="tx-btn tx-btn-danger mono"
                                        data-test="recovery-reset-btn"
                                        onclick={startRecoveryReset}
                                        disabled={savingRecoveryReset}
                                    >
                                        reset to new
                                    </button>
                                {:else}
                                    <span
                                        class="tx-nt-field-confirm mono"
                                        data-test="recovery-confirm-prompt"
                                    >
                                        reset to new?
                                    </span>
                                    <button
                                        type="button"
                                        class="tx-btn tx-btn-danger mono"
                                        data-test="recovery-confirm-btn"
                                        onclick={commitRecoveryReset}
                                        disabled={savingRecoveryReset}
                                    >
                                        {savingRecoveryReset
                                            ? "resetting…"
                                            : "confirm"}
                                    </button>
                                    <button
                                        type="button"
                                        class="tx-btn tx-btn-ghost mono"
                                        data-test="recovery-cancel-btn"
                                        onclick={cancelRecoveryReset}
                                        disabled={savingRecoveryReset}
                                    >
                                        cancel
                                    </button>
                                {/if}
                            </div>

                            {#if errorRecoveryReset}
                                <p
                                    class="tx-error mono"
                                    role="alert"
                                    data-test="recovery-reset-error"
                                >
                                    {errorRecoveryReset}
                                </p>
                            {/if}
                        </div>
                    {/if}

                    {#if recoverySuccess}
                        <p
                            class="tx-recovery-success mono"
                            role="status"
                            data-test="recovery-success"
                        >
                            ✓ {recoverySuccess}
                        </p>
                    {/if}
                </div>
            {:else if active === "sync"}
                <div class="tx-card" data-testid="settings-sync-card">
                    <div class="tx-card-head">
                        <Caption>// sync</Caption>
                        <span class="tx-card-hand hand" aria-hidden="true">your collection, your server</span>
                    </div>
                    <div class="tx-sync-status">
                        <span class="tx-sync-dot" aria-hidden="true"></span>
                        <div class="tx-sync-status-text">
                            <div class="tx-sync-label mono">connected</div>
                            <div class="tx-hint mono">m4 self-hosted sync arrives in a later release · current build is local-only</div>
                        </div>
                    </div>
                    <div class="tx-row">
                        <div class="tx-meta-key mono">server</div>
                        <div class="mono">https://anki.yourdomain.dev <span class="tx-coming-soon mono">— preview</span></div>
                    </div>
                    <div class="tx-row">
                        <div class="tx-meta-key mono">devices</div>
                        <div class="mono">this browser</div>
                    </div>
                </div>
            {:else if active === "admin"}
                <div class="tx-card" data-testid="settings-admin-card">
                    <div class="tx-card-head">
                        <Caption>// users</Caption>
                        <span class="tx-card-hand hand" aria-hidden="true">friends sharing this server</span>
                    </div>
                    <form
                        class="tx-pw-form tx-admin-create-form"
                        data-testid="settings-admin-create-form"
                        onsubmit={submitAdminCreate}
                    >
                        <Caption>// add user</Caption>
                        <label class="tx-pw-field">
                            <span class="tx-pw-label">username</span>
                            <input
                                type="text"
                                autocomplete="off"
                                autocapitalize="off"
                                spellcheck="false"
                                bind:value={adminCreateUsername}
                                data-testid="settings-admin-create-username"
                                disabled={adminCreateSaving}
                            />
                        </label>
                        <label class="tx-pw-field">
                            <span class="tx-pw-label">password</span>
                            <input
                                type="password"
                                autocomplete="new-password"
                                bind:value={adminCreatePassword}
                                data-testid="settings-admin-create-password"
                                disabled={adminCreateSaving}
                            />
                        </label>
                        {#if adminCreateError}
                            <p
                                class="tx-account-msg tx-account-msg-err mono"
                                data-testid="settings-admin-create-error"
                                role="alert"
                            >
                                {adminCreateError}
                            </p>
                        {/if}
                        <div class="tx-pw-actions">
                            <button
                                type="submit"
                                class="tx-pw-submit"
                                data-testid="settings-admin-create-submit"
                                disabled={adminCreateSaving}
                            >
                                {adminCreateSaving ? "adding…" : "add user"}
                            </button>
                        </div>
                    </form>
                    {#if adminError}
                        <p
                            class="tx-account-msg tx-account-msg-err mono"
                            data-testid="settings-admin-error"
                            role="alert"
                        >
                            {adminError}
                        </p>
                    {/if}
                    {#if adminSuccess}
                        <p
                            class="tx-account-msg tx-account-msg-ok mono"
                            data-testid="settings-admin-success"
                            role="status"
                        >
                            {adminSuccess}
                        </p>
                    {/if}
                    {#if adminLoading && adminUsers.length === 0}
                        <p class="tx-hint mono" data-testid="settings-admin-loading">// loading users…</p>
                    {:else if adminUsers.length === 0 && !adminError}
                        <p class="tx-hint mono">// no users yet</p>
                    {:else}
                        <ul class="tx-admin-list mono" data-testid="settings-admin-list">
                            {#each adminUsers as u (u.username)}
                                <li
                                    class="tx-admin-row"
                                    class:tx-admin-row-disabled={u.disabled_at !== null}
                                    data-testid="settings-admin-row-{u.username}"
                                >
                                    <div class="tx-admin-row-head">
                                        <span class="tx-admin-name">
                                            {u.username}
                                            {#if u.disabled_at !== null}
                                                <span class="tx-admin-badge" aria-label="disabled">disabled</span>
                                            {/if}
                                        </span>
                                        <div class="tx-admin-actions">
                                            <button
                                                type="button"
                                                class="tx-account-link"
                                                data-testid="settings-admin-disable-{u.username}"
                                                onclick={() => toggleAdminDisable(u)}
                                                disabled={adminBusyUser !== null
                                                    || (auth.user?.username === u.username)}
                                            >
                                                {u.disabled_at !== null ? "enable" : "disable"}
                                            </button>
                                            <button
                                                type="button"
                                                class="tx-account-link"
                                                data-testid="settings-admin-reset-{u.username}"
                                                onclick={() => openAdminResetForm(u.username)}
                                                disabled={adminBusyUser !== null}
                                            >
                                                {adminResetUser === u.username ? "cancel" : "reset password"}
                                            </button>
                                        </div>
                                    </div>
                                    {#if adminResetUser === u.username}
                                        <form
                                            class="tx-pw-form tx-admin-reset-form"
                                            data-testid="settings-admin-reset-form-{u.username}"
                                            onsubmit={submitAdminReset}
                                        >
                                            <label class="tx-pw-field">
                                                <span class="tx-pw-label">new</span>
                                                <input
                                                    type="password"
                                                    autocomplete="new-password"
                                                    bind:value={adminResetNew}
                                                    data-testid="settings-admin-reset-new"
                                                    disabled={adminResetSaving}
                                                />
                                            </label>
                                            <label class="tx-pw-field">
                                                <span class="tx-pw-label">confirm</span>
                                                <input
                                                    type="password"
                                                    autocomplete="new-password"
                                                    bind:value={adminResetConfirm}
                                                    data-testid="settings-admin-reset-confirm"
                                                    disabled={adminResetSaving}
                                                />
                                            </label>
                                            {#if adminResetError}
                                                <p
                                                    class="tx-account-msg tx-account-msg-err mono"
                                                    data-testid="settings-admin-reset-error"
                                                    role="alert"
                                                >
                                                    {adminResetError}
                                                </p>
                                            {/if}
                                            <div class="tx-pw-actions">
                                                <button
                                                    type="submit"
                                                    class="tx-pw-submit"
                                                    data-testid="settings-admin-reset-submit"
                                                    disabled={adminResetSaving}
                                                >
                                                    {adminResetSaving ? "saving…" : "reset password"}
                                                </button>
                                                <button
                                                    type="button"
                                                    class="tx-pw-cancel"
                                                    onclick={closeAdminResetForm}
                                                    disabled={adminResetSaving}
                                                >
                                                    cancel
                                                </button>
                                            </div>
                                        </form>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    {/if}
                    <div class="tx-admin-footer">
                        <button
                            type="button"
                            class="tx-account-link"
                            data-testid="settings-admin-refresh"
                            onclick={loadAdminUsers}
                            disabled={adminLoading}
                        >
                            {adminLoading ? "refreshing…" : "refresh"}
                        </button>
                    </div>
                </div>
            {:else}
                <div class="tx-card tx-card-placeholder" data-testid="settings-placeholder-card">
                    <div class="tx-card-head">
                        <Caption>// {active}</Caption>
                        <span class="tx-card-hand hand" aria-hidden="true">coming soon</span>
                    </div>
                    <p class="tx-hint mono">
                        content for <strong>{active}</strong> will live here.
                        placeholder until the data layer lands.
                    </p>
                </div>
            {/if}
        </div>
    </section>
</div>

<style>
    .tx-page {
        max-width: 1280px;
        margin: 0 auto;
        padding: var(--space-8) var(--space-6) var(--space-12);
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
    }

    /* ============== HEADER ============== */
    .tx-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: var(--space-4);
    }
    .tx-head-left {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .tx-title {
        font-size: 28px;
        font-weight: 600;
        letter-spacing: -0.02em;
        margin: 4px 0 0;
        color: var(--ink);
        line-height: 1.05;
    }
    .tx-title-hand {
        font-family: var(--font-hand);
        color: var(--accent);
        font-size: 22px;
        margin-left: 12px;
        letter-spacing: 0;
        text-transform: lowercase;
    }
    .tx-subtitle {
        font-size: 12px;
        color: var(--ink-mute);
        margin: 4px 0 0;
        letter-spacing: 0.04em;
        display: flex;
        gap: 10px;
        align-items: baseline;
        flex-wrap: wrap;
    }
    .tx-subtitle-kbd {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.1em;
        padding: 2px 8px;
        border: 1px dashed var(--rule);
        border-radius: 999px;
    }
    .tx-head-right {
        color: var(--ink);
        opacity: 0.55;
    }

    /* ============== SHELL (sidebar + panel) ============== */
    .tx-shell {
        display: grid;
        grid-template-columns: 240px 1fr;
        gap: var(--space-6);
        align-items: start;
    }

    /* ============== SIDEBAR ============== */
    .tx-sidebar {
        position: sticky;
        top: var(--space-6);
        align-self: start;
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 18px 16px;
        background: var(--bg-soft);
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-stamp-sm);
    }
    .tx-sidebar-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .tx-nav {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 4px;
    }
    .tx-nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        font-size: 12px;
        letter-spacing: 0.02em;
        background: transparent;
        border: 1.2px solid transparent;
        border-radius: var(--radius);
        color: var(--ink-soft);
        cursor: pointer;
        text-align: left;
        transition: background-color 100ms ease, color 100ms ease,
            border-color 100ms ease, box-shadow 100ms ease;
    }
    .tx-nav-item:hover:not(.tx-nav-item-active) {
        background: var(--paper);
        color: var(--ink);
    }
    .tx-nav-item:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .tx-nav-item-active {
        background: var(--paper);
        border-color: var(--ink);
        color: var(--ink);
        box-shadow: var(--shadow-stamp-sm);
        font-weight: 500;
    }
    .tx-nav-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        flex: 0 0 auto;
        color: var(--ink);
    }
    .tx-nav-label {
        flex: 1;
        text-transform: lowercase;
    }

    .tx-sidebar-account {
        padding-top: 14px;
        border-top: 1px dashed var(--rule);
    }
    .tx-account-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: var(--paper);
        border: 1.2px solid var(--ink);
        border-radius: var(--radius);
        margin-top: 6px;
        font-size: 12px;
        color: var(--ink);
    }
    .tx-account-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        color: var(--ink);
    }
    .tx-account-name {
        flex: 1;
        font-weight: 500;
    }
    .tx-logout-btn {
        margin-top: 8px;
        padding: 6px 10px;
        font-size: 11px;
        letter-spacing: 0.06em;
        background: transparent;
        border: 1.2px dashed var(--rule);
        border-radius: var(--radius);
        color: var(--ink-soft);
        cursor: pointer;
        text-align: center;
        text-transform: lowercase;
        transition: color 120ms ease, border-color 120ms ease,
            background-color 120ms ease;
    }
    .tx-logout-btn:hover {
        color: var(--due);
        border-color: var(--due);
        border-style: solid;
        background: color-mix(in oklch, var(--due) 8%, transparent);
    }
    .tx-coming-soon {
        font-style: italic;
        color: var(--ink-mute);
    }
    .tx-account-link {
        margin-top: 8px;
        padding: 6px 0;
        background: transparent;
        border: 0;
        border-bottom: 1.2px dashed var(--rule);
        color: var(--ink-soft);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-align: left;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease;
    }
    .tx-account-link:hover {
        color: var(--ink);
        border-bottom-color: var(--ink);
        border-bottom-style: solid;
    }
    .tx-pw-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
        padding: 10px;
        border: 1.2px dashed var(--rule);
        border-radius: var(--radius);
        background: color-mix(in oklch, var(--paper) 92%, transparent);
    }
    .tx-pw-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .tx-pw-label {
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: lowercase;
        color: var(--ink-soft);
    }
    .tx-pw-form input {
        width: 100%;
        padding: 5px 8px;
        font-size: 12px;
        font-family: var(--font-mono);
        color: var(--ink);
        background: var(--paper);
        border: 1.2px solid var(--rule);
        border-radius: var(--radius);
        outline: none;
        transition: border-color 120ms ease;
    }
    .tx-pw-form input:focus {
        border-color: var(--ink);
    }
    .tx-pw-form input:disabled {
        color: var(--ink-mute);
        background: color-mix(in oklch, var(--paper) 88%, transparent);
    }
    .tx-pw-actions {
        display: flex;
        gap: 6px;
        margin-top: 4px;
    }
    .tx-pw-submit,
    .tx-pw-cancel {
        flex: 1;
        padding: 6px 8px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: lowercase;
        border: 1.2px solid var(--ink);
        border-radius: var(--radius);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease,
            border-color 120ms ease;
    }
    .tx-pw-submit {
        background: var(--ink);
        color: var(--paper);
    }
    .tx-pw-submit:hover:not(:disabled) {
        background: color-mix(in oklch, var(--ink) 88%, transparent);
    }
    .tx-pw-submit:disabled,
    .tx-pw-cancel:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .tx-pw-cancel {
        background: transparent;
        color: var(--ink-soft);
        border-style: dashed;
        border-color: var(--rule);
    }
    .tx-pw-cancel:hover:not(:disabled) {
        color: var(--ink);
        border-color: var(--ink);
        border-style: solid;
    }
    .tx-account-msg {
        margin-top: 6px;
        font-size: 10px;
        letter-spacing: 0.04em;
    }
    .tx-account-msg-ok {
        color: var(--ok, var(--ink-soft));
    }
    .tx-account-msg-err {
        color: var(--due);
    }

    /* Phase B2: admin user-list + per-row disable / reset-password
       inline form. Borrows the .tx-pw-form rules (already styled
       above) for inputs/buttons; only the list scaffolding is new. */
    .tx-admin-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .tx-admin-row {
        padding: 10px 12px;
        border: 1.2px solid var(--rule);
        border-radius: var(--radius);
        background: color-mix(in oklch, var(--paper) 96%, transparent);
        transition: border-color 120ms ease, background-color 120ms ease;
    }
    .tx-admin-row-disabled {
        opacity: 0.7;
        border-style: dashed;
    }
    .tx-admin-row-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }
    .tx-admin-name {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--ink);
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }
    .tx-admin-badge {
        font-size: 9.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 2px 6px;
        border: 1px dashed var(--rule);
        border-radius: var(--radius);
        color: var(--ink-mute);
    }
    .tx-admin-actions {
        display: inline-flex;
        gap: 12px;
    }
    .tx-admin-reset-form {
        margin-top: 8px;
    }
    /* WS2: "add user" form sits between the card head and the user list;
       a dashed underline keeps it visually distinct from the list rows
       without introducing a new surface treatment. */
    .tx-admin-create-form {
        margin-bottom: 14px;
        padding-bottom: 14px;
        border-bottom: 1px dashed var(--rule);
    }
    .tx-admin-footer {
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px dashed var(--rule);
    }

    .tx-sidebar-build {
        padding-top: 14px;
        border-top: 1px dashed var(--rule);
    }
    .tx-build {
        font-size: 11px;
        color: var(--ink-soft);
        line-height: 1.6;
        margin-top: 4px;
    }
    .tx-build-mute {
        color: var(--ink-mute);
    }
    .tx-build-ok {
        color: var(--accent);
        margin-top: 4px;
    }

    /* ============== PANEL ============== */
    .tx-panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        min-width: 0;
    }
    .tx-panel-head {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-bottom: var(--space-4);
        border-bottom: 1.5px dashed var(--rule);
    }
    .tx-panel-title {
        font-size: 26px;
        font-weight: 600;
        letter-spacing: -0.02em;
        margin: 4px 0 0;
        color: var(--ink);
        line-height: 1.05;
    }
    .tx-panel-hand {
        font-family: var(--font-hand);
        color: var(--accent);
        font-size: 22px;
        margin-left: 12px;
        text-transform: lowercase;
        letter-spacing: 0;
    }
    .tx-panel-sub {
        font-size: 12px;
        color: var(--ink-mute);
        margin: 4px 0 0;
        letter-spacing: 0.04em;
    }

    /* ============== CARD ============== */
    .tx-card {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        padding: var(--space-5) var(--space-5);
        background: var(--paper);
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-stamp-sm);
    }
    .tx-card-head {
        display: flex;
        align-items: baseline;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 4px;
    }
    .tx-card-hand {
        font-family: var(--font-hand);
        font-size: 18px;
        color: var(--accent);
        text-transform: lowercase;
    }
    .tx-card-placeholder {
        background: var(--bg-soft);
        border-style: dashed;
        box-shadow: none;
    }

    /* ============== ERROR / BANNER ============== */
    .tx-banner {
        padding: 10px 14px;
        border: 1.5px solid var(--rule);
        border-radius: var(--radius-md);
        background: var(--paper);
        font-size: 12px;
        line-height: 1.45;
        letter-spacing: 0.02em;
    }
    .tx-banner-error {
        border-color: var(--due);
        background: color-mix(in oklch, var(--due) 8%, var(--paper));
        color: var(--due);
    }
    .tx-banner-detail {
        margin-top: 4px;
        font-size: 11px;
        color: var(--ink-soft);
    }
    .tx-disclaimer {
        margin: 0;
        padding: 6px 10px;
        font-size: 11px;
        color: var(--ink-mute);
        font-style: italic;
        letter-spacing: 0.02em;
    }
    .tx-error {
        font-size: 11px;
        color: var(--due);
        margin: 4px 0 0;
        letter-spacing: 0.02em;
    }
    .tx-saving {
        font-size: 11px;
        color: var(--ink-mute);
        font-style: italic;
        letter-spacing: 0.04em;
    }

    /* ============== LABELS / HINTS ============== */
    .tx-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--ink);
        letter-spacing: 0.02em;
        text-transform: lowercase;
    }
    .tx-hint {
        font-size: 11px;
        color: var(--ink-mute);
        margin: 2px 0 0;
        line-height: 1.5;
        letter-spacing: 0.02em;
    }

    /* ============== PRESET ROW ============== */
    .tx-preset-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-top: var(--space-2);
    }
    .tx-create-preset-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-top: var(--space-3);
        padding-top: var(--space-3);
        border-top: 1px dashed var(--rule);
    }

    /* ============== SELECTS / INPUTS ============== */
    .tx-select-wrap {
        position: relative;
        min-width: 14rem;
    }
    .tx-select {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        font-size: 13px;
        font-family: var(--font-mono);
        padding: 8px 28px 8px 12px;
        background: var(--paper);
        color: var(--ink);
        border: 1.2px solid var(--ink);
        border-radius: 4px;
        cursor: pointer;
        line-height: 1.4;
    }
    .tx-select:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .tx-select:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .tx-select-caret {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 11px;
        color: var(--ink-mute);
        pointer-events: none;
    }

    .tx-input {
        flex: 1 1 16rem;
        min-width: 12rem;
        padding: 8px 12px;
        background: var(--paper);
        color: var(--ink);
        border: 1.2px solid var(--ink);
        border-radius: 4px;
        font-family: var(--font-mono);
        font-size: 13px;
        line-height: 1.4;
    }
    .tx-input:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .tx-input:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    .tx-num-input {
        width: 7rem;
        padding: 8px 12px;
        background: var(--paper);
        color: var(--ink);
        border: 1.2px solid var(--ink);
        border-radius: 4px;
        font-family: var(--font-mono);
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        text-align: right;
    }
    .tx-num-input:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .tx-num-input:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    /* ============== BUTTONS ============== */
    .tx-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        letter-spacing: 0.04em;
        padding: 8px 14px;
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        background: var(--paper);
        color: var(--ink);
        cursor: pointer;
        text-decoration: none;
        line-height: 1;
        text-transform: lowercase;
        transition: transform 80ms ease, box-shadow 80ms ease,
            background-color 100ms ease, color 100ms ease;
    }
    .tx-btn:hover:not(:disabled) {
        background: var(--bg-soft);
    }
    .tx-btn:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
    }
    .tx-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
    }
    .tx-btn-paper {
        background: var(--paper);
        box-shadow: var(--shadow-stamp-sm);
    }
    .tx-btn-paper:hover:not(:disabled) {
        transform: translate(-1px, -1px);
        box-shadow: var(--shadow-stamp-md);
    }
    .tx-btn-ghost {
        background: transparent;
        border-color: var(--rule);
        color: var(--ink-soft);
        box-shadow: none;
    }
    .tx-btn-ghost:hover:not(:disabled) {
        background: var(--paper);
        border-color: var(--ink);
        color: var(--ink);
    }
    .tx-btn-primary {
        background: var(--ink);
        color: var(--bg);
        box-shadow: var(--shadow-stamp-sm);
    }
    .tx-btn-primary:hover:not(:disabled) {
        background: var(--ink);
        transform: translate(-1px, -1px);
        box-shadow: var(--shadow-stamp-md);
    }
    .tx-btn-danger {
        background: var(--paper);
        color: var(--due);
        border-color: var(--due);
    }
    .tx-btn-danger:hover:not(:disabled) {
        background: var(--due);
        color: var(--bg);
    }

    /* ============== FIELD (label + control row) ============== */
    .tx-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-3) 0;
        border-bottom: 1px dashed var(--rule);
    }
    .tx-field-last,
    .tx-field:last-child {
        border-bottom: 0;
    }
    .tx-field-head {
        display: grid;
        grid-template-columns: minmax(180px, 1fr) auto;
        gap: var(--space-4);
        align-items: flex-start;
    }
    .tx-field-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .tx-toggle-cell {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        justify-self: end;
    }
    .tx-checkbox {
        accent-color: var(--accent);
        cursor: pointer;
        width: 16px;
        height: 16px;
    }
    .tx-checkbox:disabled {
        cursor: not-allowed;
        opacity: 0.55;
    }

    .tx-value-pill {
        font-variant-numeric: tabular-nums;
        font-weight: 500;
        padding: 4px 12px;
        background: var(--accent-soft);
        color: var(--ink);
        border: 1px solid var(--ink);
        border-radius: var(--radius-pill);
        font-size: 12px;
        align-self: flex-start;
    }

    .tx-range {
        width: 100%;
        accent-color: var(--accent);
        margin-top: var(--space-2);
    }
    .tx-range:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .tx-scale {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.04em;
        margin-top: 2px;
    }

    /* ============== SEGMENTED ============== */
    .tx-segmented {
        display: inline-flex;
        border: 1.2px solid var(--ink);
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--paper);
        align-self: flex-start;
    }
    .tx-segment {
        padding: 7px 14px;
        background: transparent;
        color: var(--ink-soft);
        border: 0;
        border-left: 1.2px solid var(--ink);
        cursor: pointer;
        font-family: var(--font-mono);
        font-size: 12px;
        letter-spacing: 0.04em;
        text-transform: lowercase;
        transition: background 120ms ease, color 120ms ease;
    }
    .tx-segment:first-child {
        border-left: 0;
    }
    .tx-segment:hover:not(:disabled):not(.tx-segment-active) {
        background: var(--bg-soft);
        color: var(--ink);
    }
    .tx-segment-active {
        background: var(--ink);
        color: var(--bg);
        cursor: default;
    }
    .tx-segment:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    /* ============== OPTIMIZE / WEIGHTS ============== */
    .tx-optimize-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 4px;
    }
    .tx-health-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--ink-soft);
        letter-spacing: 0.04em;
        cursor: pointer;
        user-select: none;
    }
    .tx-weights {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
        gap: 8px;
        margin-top: var(--space-3);
    }
    .tx-w-cell {
        padding: 8px 10px;
        background: var(--bg-soft);
        border: 1.2px solid var(--rule);
        border-radius: var(--radius);
    }
    .tx-w-i {
        font-size: 9px;
        color: var(--ink-mute);
        letter-spacing: 0.04em;
    }
    .tx-w-v {
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--ink);
        margin-top: 2px;
    }

    /* ============== THEME PICKER ============== */
    .tx-theme-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-top: var(--space-2);
    }
    .tx-theme-opt {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--paper);
        border: 1.5px solid var(--ink);
        border-radius: var(--radius-md);
        cursor: pointer;
        position: relative;
        transition: transform 80ms ease, box-shadow 80ms ease;
    }
    .tx-theme-opt:has(input:checked) {
        box-shadow: var(--shadow-stamp-md);
        transform: translate(-1px, -1px);
    }
    .tx-theme-opt input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
    }
    .tx-theme-opt span {
        font-size: 12px;
        color: var(--ink);
        letter-spacing: 0.04em;
        text-transform: lowercase;
    }
    .tx-theme-swatch {
        aspect-ratio: 16 / 10;
        border-radius: var(--radius);
        border: 1.2px solid var(--ink);
    }
    .tx-theme-swatch-light {
        background: linear-gradient(135deg, oklch(95% 0.018 82) 50%, oklch(90% 0.022 80) 50%);
    }
    .tx-theme-swatch-dark {
        background: linear-gradient(135deg, oklch(15.5% 0.012 60) 50%, oklch(20% 0.014 62) 50%);
    }
    .tx-theme-swatch-auto {
        background: linear-gradient(135deg, oklch(95% 0.018 82) 50%, oklch(15.5% 0.012 60) 50%);
    }

    /* ============== NOTETYPES ============== */
    .tx-nt-list {
        list-style: none;
        margin: var(--space-2) 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .tx-nt-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 0;
        border-top: 1px dashed var(--rule);
    }
    .tx-nt-row:first-child {
        border-top: 0;
    }
    .tx-nt-row-head {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    .tx-nt-disclose {
        flex: 1;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 0;
        background: none;
        border: 0;
        text-align: left;
        cursor: pointer;
        color: inherit;
        font: inherit;
    }
    .tx-nt-disclose:hover .tx-nt-name {
        color: var(--accent);
    }
    .tx-nt-chev {
        display: inline-flex;
        width: 12px;
        font-size: 13px;
        color: var(--ink-mute);
        transition: transform 120ms ease;
    }
    .tx-nt-chev-open {
        transform: rotate(90deg);
    }
    .tx-nt-name {
        flex: 1;
        font-size: 13px;
        color: var(--ink);
    }
    .tx-nt-meta {
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.04em;
    }
    .tx-nt-fields {
        margin-left: 22px;
        padding: 8px 0 4px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .tx-nt-fields-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .tx-nt-field-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--ink);
    }
    .tx-nt-field-ord {
        width: 22px;
        color: var(--ink-mute);
        font-variant-numeric: tabular-nums;
        font-size: 11px;
    }
    .tx-nt-field-name {
        flex: 1;
    }
    .tx-nt-field-x {
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        background: none;
        border: 0;
        border-radius: var(--radius);
        color: var(--ink-mute);
        cursor: pointer;
        transition: color 120ms ease, background 120ms ease;
    }
    .tx-nt-field-x:hover:not(:disabled) {
        color: var(--due);
        background: color-mix(in oklch, var(--due) 8%, transparent);
    }
    .tx-nt-field-x:disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }
    .tx-nt-field-confirm {
        font-size: 11px;
        color: var(--due);
        letter-spacing: 0.04em;
    }
    .tx-nt-field-add {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .tx-nt-add-btn {
        align-self: flex-start;
    }
    .tx-nt-input {
        max-width: 22rem;
    }

    /* ============== RECOVERY ============== */
    .tx-recovery-lookup {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: var(--space-2);
    }
    .tx-recovery-lookup-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .tx-recovery-input {
        flex: 1;
        max-width: 24rem;
    }
    .tx-recovery-detail {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px 16px;
        background: var(--bg-soft);
        border: 1.2px solid var(--ink);
        border-radius: var(--radius-md);
        margin-top: var(--space-2);
    }
    .tx-recovery-row {
        display: grid;
        grid-template-columns: 130px 1fr;
        gap: 12px;
        font-size: 12px;
    }
    .tx-recovery-front {
        font-size: 11px;
        color: var(--ink);
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.5;
    }
    .tx-recovery-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: var(--space-2);
        flex-wrap: wrap;
    }
    .tx-recovery-success {
        font-size: 12px;
        color: var(--accent);
        letter-spacing: 0.02em;
    }
    .tx-meta-key {
        color: var(--ink-mute);
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: lowercase;
    }

    /* ============== SYNC ============== */
    .tx-sync-status {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 10px 12px;
        background: var(--bg-soft);
        border: 1.2px solid var(--ink);
        border-radius: var(--radius-md);
    }
    .tx-sync-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--accent);
        border: 1.2px solid var(--ink);
        box-shadow: 0 0 0 4px color-mix(in oklch, var(--accent) 22%, transparent);
        flex: 0 0 auto;
    }
    .tx-sync-status-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .tx-sync-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--accent);
        letter-spacing: 0.04em;
        text-transform: lowercase;
    }
    .tx-row {
        display: grid;
        grid-template-columns: 130px 1fr;
        gap: 12px;
        padding: 10px 0;
        border-top: 1px dashed var(--rule);
        font-size: 12px;
        color: var(--ink);
    }
    .tx-row:first-of-type {
        border-top: 0;
    }

    /* ============== MOBILE (≤768px) ============== */
    @media (max-width: 1024px) {
        .tx-shell {
            grid-template-columns: 1fr;
            gap: var(--space-5);
        }
        .tx-sidebar {
            position: static;
        }
        .tx-nav {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 4px;
        }
    }

    @media (max-width: 768px) {
        .tx-page {
            padding: var(--space-5) var(--space-4) var(--space-10);
            gap: var(--space-5);
        }
        .tx-title {
            font-size: 22px;
        }
        .tx-title-hand {
            font-size: 18px;
        }
        .tx-subtitle-kbd {
            display: none;
        }
        .tx-head-right {
            display: none;
        }
        .tx-shell {
            gap: var(--space-4);
        }
        .tx-sidebar {
            padding: 14px 14px;
            gap: 14px;
        }
        .tx-nav {
            grid-template-columns: 1fr;
        }
        .tx-panel-title {
            font-size: 22px;
        }
        .tx-panel-hand {
            font-size: 18px;
            margin-left: 8px;
        }
        .tx-card {
            padding: var(--space-4) var(--space-4);
        }
        .tx-field-head {
            grid-template-columns: 1fr;
            gap: var(--space-2);
        }
        .tx-toggle-cell {
            justify-self: start;
        }
        .tx-value-pill {
            align-self: flex-start;
        }
        .tx-segmented {
            align-self: flex-start;
        }
        .tx-theme-grid {
            grid-template-columns: 1fr;
        }
        .tx-recovery-row {
            grid-template-columns: 1fr;
            gap: 4px;
        }
        .tx-row {
            grid-template-columns: 1fr;
            gap: 4px;
        }
        .tx-num-input {
            width: 100%;
        }
        .tx-select-wrap {
            min-width: 100%;
        }
    }
</style>
