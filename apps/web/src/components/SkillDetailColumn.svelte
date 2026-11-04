<script>
  let {selectedSkill = null,
    bind:selectedAgentToEmbed,
    activeTab = $bindable("content"),
    isEmbedding = false,
    searchQuery = "",
    agentsList = [],
    onreembed,
    ondelete,
    onembed,
    onunembed,
    onregistry
  ,
    skillDetailLoading,
    skills
  } = $props();
</script>

      <div class="lg:col-span-2">
        {#if skillDetailLoading}
          <div class="p-12 text-center rounded-3xl border" style="background: var(--color-surface); border-color: var(--color-border);">
            <div class="inline-block animate-spin w-8 h-8 rounded-full border-4 border-t-transparent mb-3" style="border-color: var(--color-primary); border-top-color: transparent;"></div>
            <p class="text-xs font-semibold" style="color: var(--color-text-muted);">Fetching skill content...</p>
          </div>
        {:else if selectedSkill}
          <div class="p-6 rounded-3xl border shadow-sm space-y-6" style="background: var(--color-surface); border-color: var(--color-border);">
            <!-- Detail Header -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4" style="border-color: var(--color-border);">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-xl font-bold" style="color: var(--color-text);">{selectedSkill.name}</h2>
                  <span class="text-xs px-2.5 py-0.5 rounded-full border font-bold uppercase" style="background: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
                    {selectedSkill.type || 'skill'}
                  </span>
                </div>
                <p class="text-[11px] font-mono mt-1" style="color: var(--color-text-muted);">
                  Path: {selectedSkill.file_path || 'Embedded in SQLite database'}
                </p>
              </div>

              <!-- Quick Action Buttons -->
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onclick={() => ondelete(selectedSkill.name)}
                  class="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all text-status-danger border-status-danger-soft bg-status-danger-soft hover:bg-status-danger-soft cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Delete Skill</span>
                </button>
              </div>
            </div>

            <!-- Embed Into Agent Controller -->
            <div class="p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4" style="background: var(--color-surface-hover); border-color: var(--color-border);">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-status-success-soft animate-pulse"></span>
                <span class="text-xs font-bold" style="color: var(--color-text);">Embed / Unembed for Ninja Subagent:</span>
              </div>

              <div class="flex items-center gap-2 w-full sm:w-auto">
                <select
                  bind:value={selectedAgentToEmbed}
                  class="px-3 py-1.5 rounded-[3px] border text-xs font-semibold focus:outline-none login-field-effect"
                  style="background: var(--color-surface); color: var(--color-text);"
                >
                  {#each agentsList as ag}
                    <option value={ag.id}>{ag.name}</option>
                  {/each}
                </select>

                <button
                  type="button"
                  onclick={() => onembed(selectedSkill.name, selectedAgentToEmbed)}
                  class="px-3 py-1.5 rounded-[3px] border text-xs font-bold transition-all hover:scale-105 cursor-pointer text-status-success border-status-success-soft bg-status-success-soft/15"
                >
                  Embed
                </button>

                <button
                  type="button"
                  onclick={() => onunembed(selectedSkill.name, selectedAgentToEmbed)}
                  class="px-3 py-1.5 rounded-xl border text-xs font-bold transition-all hover:scale-105 cursor-pointer theme-text-secondary theme-border theme-bg-subtle"
                >
                  Unembed
                </button>
              </div>
            </div>

            <!-- Tags -->
            {#if selectedSkill.tags}
              <div>
                <span class="text-[11px] font-bold uppercase tracking-wider block mb-2" style="color: var(--color-text-muted);">Indexed Keywords & Tags:</span>
                <div class="flex flex-wrap gap-1.5">
                  {#each String(selectedSkill.tags).split(',') as tag}
                    <span class="px-2.5 py-1 rounded-lg border text-xs font-medium" style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text);">
                      {tag.trim()}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Content & Vector Tabs -->
            <div class="space-y-4">
              <div class="flex items-center gap-2 border-b pb-2" style="border-color: var(--color-border);">
                <button
                  type="button"
                  onclick={() => activeTab = 'instructions'}
                  class="btn-3d px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 {activeTab === 'instructions' ? 'btn-3d-primary text-white shadow-sm' : 'btn-3d-secondary'}"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>Instructions & Manual</span>
                </button>
                <button
                  type="button"
                  onclick={() => activeTab = 'vectors'}
                  class="btn-3d px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 {activeTab === 'vectors' ? 'btn-3d-primary text-white shadow-sm' : 'btn-3d-secondary'}"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Vector Chunks & Embeddings</span>
                  <span class="px-1.5 py-0.2 rounded-full text-[10px] font-mono {activeTab === 'vectors' ? 'theme-bg-muted' : 'bg-status-success-soft text-[var(--theme-success)] '}">
                    {selectedSkill.chunks_count || selectedSkill.chunks?.length || 0}
                  </span>
                </button>
              </div>

              {#if activeTab === 'instructions'}
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Skill Instructions / Manual:</span>
                    <span class="text-[11px] font-mono" style="color: var(--color-text-muted);">{selectedSkill.line_count || 0} lines ({selectedSkill.byte_size || 0} bytes)</span>
                  </div>
                  <pre
                    class="p-5 rounded-2xl border text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-[50vh] overflow-y-auto leading-relaxed"
                    style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text);"
                  >{selectedSkill.content}</pre>
                </div>
              {:else if activeTab === 'vectors'}
                <div class="space-y-4">
                  <!-- Model Info Banner -->
                  <div class="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs" style="background: var(--color-surface-hover); border-color: var(--color-border);">
                    <div class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full bg-status-success-soft animate-pulse"></span>
                      <span class="font-bold" style="color: var(--color-text);">Models:</span>
                      <span class="font-mono text-[var(--theme-success)] font-bold">IBM Granite 97M (ONNX) + MS MARCO MiniLM</span>
                    </div>
                    <div class="flex items-center gap-3 text-[11px] font-mono" style="color: var(--color-text-muted);">
                      <span>Embedding: <b class="text-action-primary ">384-dim (Cosine)</b></span>
                      <span>RAG Reranker: <b class="text-action-primary ">Cross-Encoder + RRF (k=60)</b></span>
                      <span>Execution: <b class="text-[var(--theme-success)] ">100% Offline INT8</b></span>
                    </div>
                  </div>

                  {#if selectedSkill.chunks && selectedSkill.chunks.length > 0}
                    <div class="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                      {#each selectedSkill.chunks as chunk}
                        <div class="p-4 rounded-2xl border space-y-2.5 transition-all hover:border-status-success-soft" style="background: var(--color-surface); border-color: var(--color-border);">
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-xs font-bold px-2 py-0.5 rounded-lg border text-action-primary border-status-info-soft bg-status-info-soft font-mono">
                              Chunk #{chunk.chunk_index + 1}
                            </span>
                            <span class="text-[10px] font-mono px-2 py-0.5 rounded-lg border text-status-success border-status-success-soft bg-status-success-soft">
                              384-dim Float32 Vector
                            </span>
                          </div>

                          <!-- Vector values snippet -->
                          {#if chunk.vector_sample && chunk.vector_sample.length > 0}
                            <div class="p-2.5 rounded-xl border text-[11px] font-mono overflow-x-auto" style="background: var(--color-surface-hover); border-color: var(--color-border);">
                              <span class="font-bold theme-text-muted mr-2">Vector Sample:</span>
                              <span class="text-[var(--theme-success)] ">
                                [{chunk.vector_sample.join(', ')} ... 384 dimensions]
                              </span>
                            </div>
                          {/if}

                          <!-- Chunk Text Snippet -->
                          <div class="text-xs font-mono p-3 rounded-xl border leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto" style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text);">
                            {chunk.chunk_text}
                          </div>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <div class="p-8 text-center rounded-2xl border space-y-3" style="background: var(--color-surface-hover); border-color: var(--color-border);">
                      <p class="text-xs font-semibold" style="color: var(--color-text-muted);">No vector chunks generated for this skill yet.</p>
                      <p class="text-[11px]" style="color: var(--color-text-muted);">Click below or run <code class="px-1.5 py-0.5 rounded theme-bg-subtle font-mono">konoha migrate</code> to vectorize all skills into sqlite-vector.</p>
                      <button
                        type="button"
                        onclick={onreembed}
                        disabled={isEmbedding}
                        class="btn-3d btn-3d-primary px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                      >
                        <svg class="w-4 h-4 {isEmbedding ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>{isEmbedding ? 'Vectorizing Skills...' : 'Re-embed Vectors Now'}</span>
                      </button>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {:else}
          {#if skills.length === 0 && searchQuery}
            <div class="p-12 text-center rounded-3xl border space-y-4" style="background: var(--color-surface); border-color: var(--color-border);">
              <div class="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center border text-xl" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
              <div>
                <h3 class="text-base font-bold" style="color: var(--color-text);">No local skills matching "{searchQuery}"</h3>
                <p class="text-xs max-w-md mx-auto mt-1" style="color: var(--color-text-muted);">
                  Search the public registry on <code class="font-mono text-xs">skills.sh</code> (exact CLI equivalent: <code class="font-mono text-xs">konoha skill search {searchQuery}</code>).
                </p>
              </div>
              <button
                type="button"
                onclick={() => onregistry(searchQuery)}
                class="px-5 py-2.5 rounded-xl text-xs font-bold text-white inline-flex items-center gap-2 shadow-md cursor-pointer hover:scale-105 transition-all"
                style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>Search skills.sh for "{searchQuery}"</span>
              </button>
            </div>
          {:else}
            <div class="p-16 text-center rounded-3xl border" style="background: var(--color-surface); border-color: var(--color-border);">
              <div class="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center border" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 class="text-sm font-bold" style="color: var(--color-text);">Select a skill to inspect</h3>
              <p class="text-xs mt-1" style="color: var(--color-text-muted);">Select any skill from the left list to view SOP instructions or embed it into agents.</p>
            </div>
          {/if}
        {/if}
      </div>
