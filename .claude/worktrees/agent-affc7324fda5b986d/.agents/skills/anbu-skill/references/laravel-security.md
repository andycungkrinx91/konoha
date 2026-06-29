# Laravel Security

> Read when: reviewing security, hardening auth, handling file uploads, managing secrets, or auditing Laravel code for vulnerabilities.

## Contents

- [Core Security Settings](#core-security-settings)
- [Authentication & Tokens](#authentication--tokens)
- [Authorization: Policies & Gates](#authorization-policies--gates)
- [Validation & Data Sanitization](#validation--data-sanitization)
- [SQL Injection Prevention](#sql-injection-prevention)
- [XSS Prevention](#xss-prevention)
- [CSRF Protection](#csrf-protection)
- [CORS Configuration](#cors-configuration)
- [File Upload Safety](#file-upload-safety)
- [Rate Limiting](#rate-limiting)
- [Secrets & Credentials](#secrets--credentials)
- [Encrypted Attributes](#encrypted-attributes)
- [Security Headers](#security-headers)
- [Signed URLs](#signed-urls)
- [Logging Without Leaking](#logging-without-leaking)
- [Dependency Security](#dependency-security)
- [Security Review Checklist](#security-review-checklist)

## Core Security Settings

- `APP_DEBUG=false` in production — **always**.
- `APP_KEY` must be set and rotated on compromise.
- `SESSION_SECURE_COOKIE=true` and `SESSION_SAME_SITE=lax` (or `strict` for sensitive apps).
- `SESSION_HTTP_ONLY=true` to prevent JavaScript access to session cookies.
- Configure trusted proxies for correct HTTPS detection.
- Regenerate sessions on login and privilege changes.

## Authentication & Tokens

- Use Laravel Sanctum for SPA/API auth, Passport for OAuth.
- Prefer short-lived tokens with refresh flows for sensitive data.
- Revoke tokens on logout and compromised accounts.

```php
Route::middleware('auth:sanctum')->get('/me', function (Request $request) {
    return $request->user();
});
```

### Password Security

```php
$validated = $request->validate([
    'password' => ['required', 'string',
        Password::min(12)->letters()->mixedCase()->numbers()->symbols()
    ],
]);
$user->update(['password' => Hash::make($validated['password'])]);
```

- Hash with `Hash::make()` — never store plaintext.
- Use Laravel's password broker for reset flows.

## Authorization: Policies & Gates

- Use policies for model-level authorization.
- Enforce in controllers and services — never rely on frontend checks alone.

```php
$this->authorize('update', $project);

Route::put('/projects/{project}', [ProjectController::class, 'update'])
    ->middleware(['auth:sanctum', 'can:update,project']);
```

## Validation & Data Sanitization

- Always validate with Form Requests.
- Use strict validation rules and type checks.
- Never trust request payloads for derived fields (user_id, role, etc.).
- Use `$fillable` or `$guarded` — avoid `Model::unguard()`.
- Prefer DTOs or explicit attribute mapping over mass assignment.

## SQL Injection Prevention

- **Strict Eloquent**: Use Eloquent or query builder exclusively.
- Zero raw DB facade queries unless impossible. If raw SQL is completely unavoidable, always use parameter binding.

```php
// ✗ Bad
DB::select("select * from users where email = '$email'");

// ✓ Good
DB::select('select * from users where email = ?', [$email]);
```

## XSS Prevention

- Blade escapes by default (`{{ }}`).
- Use `{!! !!}` only for trusted, sanitized HTML.
- Sanitize rich text with a dedicated library before storage.

## CSRF Protection

- Keep CSRF protection enabled. In Laravel 11+, configure exclusions in `bootstrap/app.php` with `$middleware->validateCsrfTokens(except: [...])`.
- Include `@csrf` in forms, send XSRF tokens for SPA requests.
- For SPA auth with Sanctum, configure stateful domains:

```php
// config/sanctum.php
'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS', 'localhost')),
```

## CORS Configuration

- Restrict origins in `config/cors.php` — avoid wildcard for authenticated routes.

```php
return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    'allowed_origins' => ['https://app.example.com'],
    'allowed_headers' => [
        'Content-Type', 'Authorization',
        'X-Requested-With', 'X-XSRF-TOKEN', 'X-CSRF-TOKEN',
    ],
    'supports_credentials' => true,
];
```

## File Upload Safety

- Validate file size, MIME type, and extension.
- Store uploads outside the public path when possible (e.g., `s3` cloud storage).
- Use randomized filenames (UUIDs) to prevent enumeration and collision.
- Scan files for malware if required.

```php
final class UploadInvoiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return (bool) $this->user()?->can('upload-invoice');
    }

    public function rules(): array
    {
        return [
            'invoice' => ['required', 'file', 'mimes:pdf', 'max:5120'],
        ];
    }
}
```

```php
use Illuminate\Support\Str;

$path = $request->file('invoice')->storeAs(
    'invoices',
    Str::uuid()->toString() . '.' . $request->file('invoice')->extension(),
    config('filesystems.private_disk', 's3')
);
```

## Rate Limiting

- Apply `throttle` middleware on auth and write endpoints.
- Use stricter limits for login, password reset, and OTP.

```php
RateLimiter::for('login', function (Request $request) {
    return [
        Limit::perMinute(5)->by($request->ip()),
        Limit::perMinute(5)->by(strtolower((string) $request->input('email'))),
    ];
});
```

## Secrets & Credentials

- Never commit secrets to source control.
- Use environment variables and secret managers.
- Rotate keys after exposure and invalidate sessions.

## Encrypted Attributes

```php
protected function casts(): array
{
    return [
        'api_token' => 'encrypted',
    ];
}
```

## Security Headers

Use web server/proxy headers when possible. Use Laravel middleware when headers depend on app context, and register custom middleware in `bootstrap/app.php` on Laravel 11+.

```php
final class SecurityHeaders
{
    public function handle(Request $request, \Closure $next): Response
    {
        $response = $next($request);
        $response->headers->add([
            'Content-Security-Policy' => "default-src 'self'",
            'Strict-Transport-Security' => 'max-age=31536000',
            'X-Frame-Options' => 'DENY',
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer',
        ]);
        return $response;
    }
}
```

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware): void {
    $middleware->append(SecurityHeaders::class);
})
```

## Signed URLs

Use for temporary, tamper-proof download links:

```php
$url = URL::temporarySignedRoute(
    'downloads.invoice',
    now()->addMinutes(15),
    ['invoice' => $invoice->id]
);

Route::get('/invoices/{invoice}/download', [InvoiceController::class, 'download'])
    ->name('downloads.invoice')
    ->middleware('signed');
```

## Logging Without Leaking

- Never log passwords, tokens, or full card data.
- Redact sensitive fields in structured logs.

```php
Log::info('User updated profile', [
    'user_id' => $user->id,
    'email' => '[REDACTED]',
    'token' => '[REDACTED]',
]);
```

## Dependency Security

- Run `composer audit` regularly.
- Pin dependencies with care and update promptly on CVEs.

## Security Review Checklist

- [ ] `APP_DEBUG=false` in production
- [ ] `APP_KEY` set and not exposed
- [ ] Session cookies: secure, httpOnly, sameSite
- [ ] Auth endpoints rate-limited
- [ ] All inputs validated via Form Requests
- [ ] Authorization enforced via policies (not just middleware)
- [ ] No mass assignment vulnerabilities (`$fillable` defined)
- [ ] File uploads validated (type, size) and stored privately
- [ ] No raw SQL without parameter binding
- [ ] CORS restricted to known origins
- [ ] Security headers applied (CSP, HSTS, X-Frame-Options)
- [ ] Secrets not in source control
- [ ] Sensitive data encrypted at rest
- [ ] Logs do not contain PII/tokens
- [ ] Dependencies audited (`composer audit`)
- [ ] Signed URLs used for sensitive downloads
