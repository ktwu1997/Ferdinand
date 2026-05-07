// Static-asset fallback for the SvelteKit mockup (Phase 30-A).
//
// Two modes:
//
// * `--features embed-mockup` (release): the `mockup/build/` directory is
//   embedded into the binary at compile time via `include_dir!()`. The
//   resulting `anki_server` is a single self-contained file — no `mockup/`
//   directory needed at runtime.
// * default (development): if `../mockup/build/` exists relative to the
//   current working directory, it is mounted via `tower-http::ServeDir`.
//   Otherwise no fallback is registered and non-API paths return 404.
//
// In both modes, the `/api/...` router from `routes::router()` is matched
// first; the static fallback only handles unmatched paths. `/` resolves
// to `index.html`.

use axum::Router;

use crate::state::ServerState;

/// Wire the static-asset fallback onto an existing API router.
///
/// The caller passes in the API `Router<ServerState>`; we attach a fallback
/// service for non-API paths and return the resulting router.
pub(crate) fn attach(api: Router<ServerState>) -> Router<ServerState> {
    #[cfg(feature = "embed-mockup")]
    {
        embedded::attach(api)
    }
    #[cfg(not(feature = "embed-mockup"))]
    {
        disk::attach(api)
    }
}

#[cfg(feature = "embed-mockup")]
mod embedded {
    use axum::body::Body;
    use axum::extract::Request;
    use axum::http::header;
    use axum::http::HeaderValue;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use axum::response::Response;
    use axum::Router;
    use include_dir::include_dir;
    use include_dir::Dir;

    use crate::state::ServerState;

    /// Mockup build output, embedded at compile time.
    ///
    /// `include_dir!()` resolves the path relative to `CARGO_MANIFEST_DIR`,
    /// so `$CARGO_MANIFEST_DIR/../mockup/build` ⇒ `<repo>/mockup/build`.
    static MOCKUP: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../mockup/build");

    pub(crate) fn attach(api: Router<ServerState>) -> Router<ServerState> {
        api.fallback(serve_embedded)
    }

    async fn serve_embedded(req: Request<Body>) -> Response {
        // Strip leading slash; "/" ⇒ "" ⇒ "index.html".
        let raw_path = req.uri().path().trim_start_matches('/');
        let lookup = if raw_path.is_empty() {
            "index.html"
        } else {
            raw_path
        };

        if let Some(file) = MOCKUP.get_file(lookup) {
            return build_response(lookup, file.contents());
        }

        // SPA fallback: unknown paths fall back to index.html so client-side
        // routing keeps working on hard-refresh of a sub-route.
        if let Some(index) = MOCKUP.get_file("index.html") {
            return build_response("index.html", index.contents());
        }

        (StatusCode::NOT_FOUND, "not found").into_response()
    }

    fn build_response(path: &str, bytes: &'static [u8]) -> Response {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        let mut response = Response::new(Body::from(bytes));
        if let Ok(value) = HeaderValue::from_str(mime.as_ref()) {
            response.headers_mut().insert(header::CONTENT_TYPE, value);
        }
        response
    }
}

#[cfg(not(feature = "embed-mockup"))]
mod disk {
    use std::path::PathBuf;

    use axum::Router;
    use tower_http::services::{ServeDir, ServeFile};

    use crate::state::ServerState;

    pub(crate) fn attach(api: Router<ServerState>) -> Router<ServerState> {
        let candidate = PathBuf::from("mockup/build");
        let alt = PathBuf::from("../mockup/build");
        let dir = if candidate.join("index.html").is_file() {
            Some(candidate)
        } else if alt.join("index.html").is_file() {
            Some(alt)
        } else {
            None
        };

        match dir {
            Some(path) => {
                tracing::info!(?path, "serving mockup from disk (dev fallback)");
                // SPA fallback: unknown paths serve index.html so client-side
                // routing keeps working on hard-refresh of a sub-route.
                // Mirrors the embedded path's behaviour at line 76.
                let index = ServeFile::new(path.join("index.html"));
                let serve = ServeDir::new(&path)
                    .append_index_html_on_directories(true)
                    .not_found_service(index);
                api.fallback_service(serve)
            }
            None => {
                tracing::debug!("no mockup/build directory found; non-API paths will 404");
                api
            }
        }
    }
}
