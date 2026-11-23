# Sentinel Security Journal

## [11-23-26] - Error Information Leakage in API Endpoints
**Vulnerability:** Two API endpoints (`/api/shows/[id]/generate` and `/api/episodes/[id]/audio`) returned raw error messages directly to clients. These messages could contain sensitive information such as database connection details, API keys, internal file paths, stack traces, or third-party service error details.

**Learning:** The codebase used parameterized queries (preventing SQL injection) and had proper authentication/authorization, but error handling in user-facing API routes leaked internal error details. This is a common oversight where developers prioritize debugging convenience over security in error responses.

**Prevention:** Created a centralized `sanitizeError` utility in `lib/errors.ts` that:
1. Logs full error details (message + stack trace) server-side for debugging
2. Returns only generic messages ("An error occurred. Please try again later.") to clients
3. Accepts a context parameter for better server-side log correlation
Applied this to both vulnerable endpoints. Added `safeErrorMessage` for cases where specific validation errors are intentionally safe to expose.