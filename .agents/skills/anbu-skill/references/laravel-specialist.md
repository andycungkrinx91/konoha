# Laravel Specialist

> Read when: building Laravel backend features — models, controllers, APIs, queues, jobs, events, testing, or deployment.

## Contents

- [Core Workflow](#core-workflow)
- [Constraints](#constraints)
- [App Structure](#app-structure)
- [Eloquent Model](#eloquent-model)
- [Controllers & API Resources](#controllers--api-resources)
- [Queued Jobs](#queued-jobs)
- [Events & Listeners](#events--listeners)
- [Policies & Gates](#policies--gates)
- [API Routing](#api-routing)
- [Testing](#testing-pest)
- [Horizon Setup](#horizon-setup)
- [Validation Checkpoints](#validation-checkpoints)
- [Performance Tips](#performance-tips)

## Core Workflow

1. **Analyze requirements** — identify models, relationships, APIs, queue needs.
2. **Design architecture** — plan schema, service layers, job queues.
3. **Implement models** — Eloquent with relationships, scopes, casts. Verify with `php artisan migrate:status`.
4. **Build features** — controllers, services, API resources, jobs. Verify with `php artisan route:list`.
5. **Test thoroughly** — feature and unit tests. Run `php artisan test` before completion (target >85% coverage).

## Constraints

### MUST DO
- PHP 8.2+ features (readonly, enums, typed properties, `declare(strict_types=1)`)
- Type hint all method parameters and return types
- Eager load relationships (avoid N+1)
- Use API resources for data transformation
- Queue long-running tasks
- Write tests (>85% coverage)
- Dependency injection via service container
- PSR-12 coding standards

### MUST NOT DO
- Raw DB facade queries (prefer Eloquent strictly)
- Skip eager loading
- Store sensitive data unencrypted
- Mix business logic in controllers
- Hardcode configuration values
- Skip Form Request validation for incoming data
- Use deprecated Laravel features
- Ignore queue failures silently

## App Structure

```text
app/
├─ Http/
│  ├─ Controllers/Api/V1/
│  ├─ Requests/
│  └─ Resources/
├─ Models/
├─ Services/
├─ Actions/              # Single-purpose action classes
├─ Jobs/
├─ Events/
├─ Listeners/
├─ Policies/
├─ Observers/
├─ Casts/
└─ Enums/
bootstrap/
└─ app.php               # Laravel 11+: routing, middleware, exceptions
```

Rules:
- Controllers handle HTTP concerns only — call services for logic.
- Services contain business logic and orchestration.
- Actions are single-purpose invokable classes for complex operations.
- Keep controllers thin.
- In Laravel 11+, create `app/Http/Middleware` only for custom middleware and register it in `bootstrap/app.php`.

## Eloquent Model

```php
<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\PostStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

final class Post extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = ['title', 'slug', 'body', 'status', 'user_id', 'category_id'];

    protected function casts(): array
    {
        return [
            'status' => PostStatus::class,
            'published_at' => 'immutable_datetime',
            'metadata' => 'array',
        ];
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class);
    }

    public function scopePublished(Builder $query): Builder
    {
        return $query->whereNotNull('published_at')
            ->where('published_at', '<=', now());
    }
}
```

### Relationships Cheatsheet
- `hasMany` / `belongsTo` — one-to-many
- `belongsToMany` — many-to-many (with pivot: `->withPivot()`, `->withTimestamps()`)
- `hasOne()->latestOfMany()` / `oldestOfMany()` — latest/oldest of has-many
- `hasManyThrough` — indirect relationships
- `morphMany` / `morphTo` — polymorphic
- `morphToMany` / `morphedByMany` — polymorphic many-to-many

### Query Optimization
```php
// Eager load (prevent N+1)
$posts = Post::with(['author', 'comments.user'])->get();

// Count relationships
$posts = Post::withCount('comments')->get();

// Conditional queries
$posts = Post::query()
    ->when($search, fn ($q) => $q->where('title', 'like', "%{$search}%"))
    ->when($category, fn ($q) => $q->where('category_id', $category))
    ->paginate(15);

// Chunk for large datasets
Post::chunk(100, fn ($posts) => /* process */);
```

## Controllers & API Resources

### Controller
```php
final class PostController extends Controller
{
    public function index(): PostCollection
    {
        return new PostCollection(
            Post::with('author')->published()->paginate(15)
        );
    }

    public function store(StorePostRequest $request): PostResource
    {
        $post = Post::create([
            ...$request->validated(),
            'user_id' => $request->user()->id,
        ]);

        return new PostResource($post);
    }

    public function show(Post $post): PostResource
    {
        $post->load(['author', 'comments.user']);
        return new PostResource($post);
    }

    public function update(UpdatePostRequest $request, Post $post): PostResource
    {
        $post->update($request->validated());
        return new PostResource($post);
    }

    public function destroy(Post $post): Response
    {
        $post->delete();
        return response()->noContent();
    }
}
```

### Form Request
```php
final class StorePostRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'slug' => ['required', 'string', 'unique:posts,slug'],
            'body' => ['required', 'string'],
            'category_id' => ['required', 'exists:categories,id'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge(['slug' => str($this->title)->slug()]);
    }
}
```

### API Resource
```php
final class PostResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'body' => $this->body,
            'status' => $this->status->value,
            'published_at' => $this->published_at?->toIso8601String(),
            'author' => new UserResource($this->whenLoaded('author')),
            'comments' => CommentResource::collection($this->whenLoaded('comments')),
            'comments_count' => $this->whenCounted('comments'),
        ];
    }
}
```

## Queued Jobs

```php
final class PublishPost implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public array $backoff = [60, 120, 300];

    public function __construct(
        public readonly Post $post,
    ) {}

    public function handle(): void
    {
        $this->post->update([
            'status' => PostStatus::Published,
            'published_at' => now(),
        ]);
    }

    public function failed(\Throwable $e): void
    {
        logger()->error('PublishPost failed', [
            'post' => $this->post->id,
            'error' => $e->getMessage(),
        ]);
    }
}
```

### Dispatching
```php
PublishPost::dispatch($post);                          // Immediate
PublishPost::dispatch($post)->onQueue('processing');   // Specific queue
PublishPost::dispatch($post)->delay(now()->addMinutes(10)); // Delayed
PublishPost::dispatch($post)->afterCommit();           // After DB commit
```

### Job Batching
```php
Bus::batch([
    new ProcessPost($post1),
    new ProcessPost($post2),
])->then(fn (Batch $batch) => /* all done */)
  ->catch(fn (Batch $batch, \Throwable $e) => /* failure */)
  ->name('Process Posts')
  ->dispatch();
```

### Unique Jobs
```php
class ProcessPost implements ShouldQueue, ShouldBeUnique
{
    public int $uniqueFor = 3600;
    public function uniqueId(): string { return $this->post->id; }
}
```

## Events & Listeners

Use model events for simple callbacks, observers for multiple hooks, and event/listener pairs for cross-concern communication.

```php
// In model
protected static function booted(): void
{
    static::creating(fn ($post) => $post->slug = str($post->title)->slug());
}
```

## Policies & Gates

```php
$this->authorize('update', $project);

// Route-level
Route::put('/projects/{project}', [ProjectController::class, 'update'])
    ->middleware(['auth:sanctum', 'can:update,project']);
```

## API Routing

```php
Route::prefix('v1')->group(function () {
    Route::get('/posts', [PostController::class, 'index']);
    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/posts', [PostController::class, 'store']);
        Route::put('/posts/{post}', [PostController::class, 'update']);
        Route::delete('/posts/{post}', [PostController::class, 'destroy']);
    });
});
```

## Testing (Pest)

```php
it('allows authenticated users to create posts', function () {
    $user = User::factory()->create();
    $category = Category::factory()->create();

    $this->actingAs($user)
        ->postJson('/api/posts', [
            'title' => 'Test',
            'body' => 'Content',
            'category_id' => $category->id,
        ])
        ->assertStatus(201);

    expect(Post::count())->toBe(1);
});

it('queues a publish job', function () {
    Queue::fake();
    $post = Post::factory()->draft()->create();

    $this->actingAs($post->author)
        ->postJson("/api/posts/{$post->id}/publish")
        ->assertAccepted();

    Queue::assertPushed(PublishPost::class, fn ($job) => $job->post->is($post));
});
```

## Horizon Setup

Use Horizon for Redis-backed queue monitoring in production:

```bash
php artisan horizon          # Start
php artisan horizon:terminate  # Graceful stop
php artisan horizon:status   # Check status
```

## Validation Checkpoints

| Stage | Command | Expected |
|-------|---------|----------|
| After migration | `php artisan migrate:status` | All migrations Ran |
| After routing | `php artisan route:list --path=api` | Routes appear with correct verbs |
| After job dispatch | `php artisan queue:work --once` | Job processes without exception |
| After implementation | `php artisan test --coverage` | >85% coverage, 0 failures |
| Before PR | `./vendor/bin/pint --test` | PSR-12 passes |

## Performance Tips

1. Always eager load relationships
2. Use chunking for large datasets
3. Index foreign keys in migrations
4. Use `select()` to limit columns
5. Cache expensive queries (Redis/Memcached)
6. Avoid heavy operations in model events — use queues
7. Use `lazy()` collections for memory-efficient processing
8. Paginate all collection endpoints
