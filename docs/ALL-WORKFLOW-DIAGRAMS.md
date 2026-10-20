# 🌊 Konoha Complete Workflows Architecture & Flow Diagrams

This document defines all active architectural workflows within **Konoha** (`konoha-mcp`) using native, responsive, and publication-ready **Mermaid** diagrams rendered in the canonical **Tokubetsu-Jonin Light Design Standard** (pure white canvas `#FFFFFF`, dark slate typography `#0F172A`, 4-color theme accent strokes, and zero dark backgrounds).

---

## 📑 Table of Contents

1. [Master Orchestration Architecture & Client-Specialist Flow](#1-master-orchestration-architecture--client-specialist-flow)
2. [Workflow 1: Core Multi-Agent MCP SDLC Orchestration Pipeline](#2-workflow-1-core-multi-agent-mcp-sdlc-orchestration-pipeline)
3. [Workflow 2: Definition-of-Readiness (DoR) Gate & Dispatch Flow](#3-workflow-2-definition-of-readiness-dor-gate--dispatch-flow)
4. [Workflow 3: Text-Based Website Build Pipeline (`build_from_text`)](#4-workflow-3-text-based-website-build-pipeline-build_from_text)
5. [Workflow 4: Mockup / Design Image Build Pipeline (`build_from_source`)](#5-workflow-4-mockup--design-image-build-pipeline-build_from_source)
6. [Workflow 5: Two-Step Zero-AI-Slop Pre-Gate & Autonomous Remediation Loop](#6-workflow-5-two-step-zero-ai-slop-pre-gate--autonomous-remediation-loop)
7. [Workflow 6: QA Automation & Token-Efficient E2E Validation Flow](#7-workflow-6-qa-automation--token-efficient-e2e-validation-flow)
8. [Workflow 7: Skills Lifecycle, SQLite FTS5 & Cross-Client 5-Tree Synchronization](#8-workflow-7-skills-lifecycle-sqlite-fts5--cross-client-5-tree-synchronization)
9. [Workflow 8: Local LLM Proxy Bridge Gateway & Sidecar Binary RPC](#9-workflow-8-local-llm-proxy-bridge-gateway--sidecar-binary-rpc)
10. [Workflow 9: Socket.dev Supply Chain Security Gate & Policy Evaluation](#10-workflow-9-socketdev-supply-chain-security-gate--policy-evaluation)
11. [Workflow 10: Kage Reviewer 98% Minimum Confidence Delivery Gate](#11-workflow-10-kage-reviewer-98-minimum-confidence-delivery-gate)
12. [Workflow 11: Telegram Remote Reporter & Whitelisted Long Polling Dispatch](#12-workflow-11-telegram-remote-reporter--whitelisted-long-polling-dispatch)
13. [Workflow 12: Cloudflare Zero Trust Ingress Tunnel & Unified Prompt Inbox Queue](#13-workflow-12-cloudflare-zero-trust-ingress-tunnel--unified-prompt-inbox-queue)
14. [Workflow 13: Native Document Engineering & Animated WebP Export Pipeline](#14-workflow-13-native-document-engineering--animated-webp-export-pipeline)

---

## 1. Master Orchestration Architecture & Client-Specialist Flow

```mermaid
---
title: Konoha Master System Architecture & Specialist Orchestration Flow
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TB
    UserPrompt["End User / Client Prompt"] --> Clients["8 Supported Coding Environments<br/>Antigravity CLI/IDE · Cursor · Claude Code<br/>OpenCode · Command Code · Codex · Pi · OMP"]
    Clients --> Orchestrator["Main Orchestrator Agent<br/>(Structured MCP Router)"]

    subgraph CoreMCP ["Konoha MCP & Storage Foundation"]
        SanninRouter["✧ Sannin MCP Router<br/>(Prompt Triage &amp; Delegation)"]
        SQLiteDB[("Unified SQLite DB<br/>~/.konoha/konoha.db<br/>(FTS5 · WAL Mode · busy_timeout=5000)")]
        SembleSearch["Semble MCP Server<br/>(Project Code Search &amp; Symbol Index)"]
        AislopScanner["Aislop MCP Server<br/>(Zero-AI-Slop Code Hygiene)"]
        SanninRouter <--> SQLiteDB
    end

    Orchestrator --> CoreMCP

    subgraph NinjaTeam ["Specialist Ninja Subagents"]
        Genin["⚑ genin<br/>(Read-only Code Scout)"]
        Kage["◎ kage<br/>(Architecture &amp; Security)"]
        Chunin["▫ chunin<br/>(Web Intel &amp; Citations)"]
        Jonin["♦ jonin<br/>(Frontend UI &amp; Tailwind)"]
        Anbu["♠ anbu<br/>(Backend, DevOps &amp; QA)"]
        Tokubetsu["⬡ tokubetsu-jonin<br/>(Documentation Scribe)"]
    end

    CoreMCP --> NinjaTeam

    subgraph QualityGate ["Verification & Quality Enforcement"]
        DoRGate["Definition-of-Readiness Gate<br/>(Advisory / Enforced Check)"]
        SlopGate["Two-Step Zero-AI-Slop Gate<br/>(100/100 Mechanical Scan)"]
        SocketGate["Socket.dev Security Gate<br/>(0 High / 0 Medium Alerts)"]
        ConfidenceGate["Kage 98% Confidence Gate<br/>(Delivery Sign-off)"]
    end

    NinjaTeam --> QualityGate
    QualityGate --> Delivery["Final Delivery &amp; User Response<br/>(Structured Confidence Report)"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style CoreMCP fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style NinjaTeam fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style QualityGate fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef clientNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef mcpNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef agentNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef gateNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;

    class UserPrompt,Clients,Orchestrator,Delivery clientNode;
    class SanninRouter,SQLiteDB,SembleSearch,AislopScanner mcpNode;
    class Genin,Kage,Chunin,Jonin,Anbu,Tokubetsu agentNode;
    class DoRGate,SlopGate,SocketGate,ConfidenceGate gateNode;
```

---

## 2. Workflow 1: Core Multi-Agent MCP SDLC Orchestration Pipeline

```mermaid
---
title: Core Multi-Agent MCP SDLC 8-Phase Lifecycle
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#8b5cf6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    Init["Prompt Ingestion"] --> Phase0["Phase 0: ROUTE (✧ Sannin)<br/>• Structured MCP arguments<br/>• Initialize status.json &amp; SQLite WAL<br/>• Assess task readiness"]
    Phase0 --> Phase1["Phase 1: EXPLORE (⚑ Genin)<br/>• Read-only symbol discovery<br/>• Map blast radius &amp; dependencies<br/>• Output findings.md &amp; result.md"]
    Phase1 --> Phase2["Phase 2: PLAN (◎ Kage)<br/>• Evaluate architecture &amp; trade-offs<br/>• Formulate plan.md checklist<br/>• Register tasks in sdlc_tasks"]

    Phase2 --> CheckResearch{"External Intel<br/>Required?"}
    CheckResearch -- "needs_research: true" --> Phase2b["Phase 2b: RESEARCH (▫ Chunin)<br/>• Web search &amp; official doc extraction<br/>• Synthesize citations into findings.md"]
    Phase2b --> Phase2
    CheckResearch -- "needs_replan: true" --> Phase2
    CheckResearch -- "Ready to execute" --> Phase3["Phase 3: EXECUTE (♦ Jonin / ♠ Anbu)<br/>• Dispatches tasks sequentially<br/>• Jonin: UI/Frontend / Tailwind v4<br/>• Anbu: Backend, API, DB &amp; DevOps<br/>• Runs build &amp; validation commands"]

    Phase3 --> Phase4["Phase 4: DOCUMENT (⬡ Tokubetsu-Jonin)<br/>• Generate final_docs.md &amp; API specs<br/>• Synchronize CHANGELOG.md"]
    Phase4 --> Phase5["Phase 5: REVIEW (◎ Kage &amp; @advisor)<br/>• Two-Step Zero-AI-Slop Pre-Gate<br/>• Socket.dev Supply Chain Gate<br/>• Definition-of-Done Verification<br/>• @advisor Final Review Evaluation"]

    Phase5 --> CheckReview{"Kage &amp; @advisor<br/>Review Approved?"}
    CheckReview -- "Approved (≥ 98% Conf &amp; Advisor OK)" --> Phase6["Phase 6: SYNTHESIZE (✧ Sannin)<br/>• Assemble final_report.md<br/>• Consolidate task evidence"]
    Phase6 --> Phase7["Phase 7: DONE<br/>• Clean transient scratch directories<br/>• Present final deliverable to user"]

    CheckReview -- "Findings / Advisor Reject" --> Remediation["Autonomous Remediation Loop<br/>• Convert findings &amp; advisor feedback into fix tasks<br/>• Circuit Breaker check (cycles &lt;= 7)<br/>• Dispatch to Jonin (UI) or Anbu (Backend)"]
    Remediation --> Phase3

    linkStyle default stroke:#334155,stroke-width:2px;

    classDef routeNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef executeNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef reviewNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef failNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;
    classDef passNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;

    class Init,Phase0,Phase7 routeNode;
    class Phase1,Phase2,Phase2b,Phase3,Phase4,Phase6 executeNode;
    class Phase5,CheckReview,CheckResearch reviewNode;
    class Remediation failNode;
```

---

## 3. Workflow 2: Definition-of-Readiness (DoR) Gate & Dispatch Flow

```mermaid
---
title: Definition-of-Readiness (DoR) Pre-Dispatch Validation Gate
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 350
---
flowchart TD
    Trigger["Task Dispatch Trigger"] --> Inspect["Inspect Task Definition<br/>(title, prompt, context, parameters)"]
    Inspect --> Engine["DoR Assessment Engine<br/>(`src/sdlc_manager.js`)"]

    subgraph AssessmentRules ["Multi-Rule Verification Engine"]
        R1["Length &amp; Context Rule<br/>• Prompt &gt; 4 words<br/>• Explicit functional directive"]
        R2["Placeholder Hygiene<br/>• Zero TODO / FIXME / ???<br/>• No unresolved pseudocode"]
        R3["File Existence Check<br/>• Target files must exist on disk<br/>• Workspace boundaries valid"]
        R4["Domain Alignment<br/>• Keywords match target specialist"]
    end

    Engine --> AssessmentRules
    AssessmentRules --> ModeGate{"Governance Mode<br/>Configuration"}

    ModeGate -- "mode: advisory (Default)" --> AdvisoryEval{"Issues<br/>Found?"}
    AdvisoryEval -- "No issues" --> Dispatch1["Dispatch Task to Specialist"]
    AdvisoryEval -- "Issues found" --> InjectHint["Inject Diagnostic Hints &amp; Warnings<br/>• Record warning in task metadata<br/>• Proceed with dispatch"]
    InjectHint --> Dispatch1

    ModeGate -- "mode: enforced" --> EnforcedEval{"Issues<br/>Found?"}
    EnforcedEval -- "No issues" --> Dispatch2["Dispatch Task to Specialist"]
    EnforcedEval -- "Issues found" --> BlockDispatch["BLOCK TASK DISPATCH<br/>• Reject execution<br/>• Return DoR failure diagnostics<br/>• Require clarified prompt"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style AssessmentRules fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef triggerNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef ruleNode fill:#ffffff,stroke:#06b6d4,color:#0f172a,stroke-width:2px;
    classDef passNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef blockNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;
    classDef evalNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;

    class Trigger,Inspect,Engine triggerNode;
    class R1,R2,R3,R4 ruleNode;
    class ModeGate,AdvisoryEval,EnforcedEval,InjectHint evalNode;
    class Dispatch1,Dispatch2 passNode;
    class BlockDispatch blockNode;
```

---

## 4. Workflow 3: Text-Based Website Build Pipeline (`build_from_text`)

```mermaid
---
title: Text-Based Website & UI Build Pipeline (build_from_text)
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    UserReq["User Prompt:<br/>'Build an e-commerce / dashboard / SaaS platform'"] --> Step1["Step 1: MCP Call `konoha.build_from_text`<br/>(name, description, framework, taste_dials)"]
    Step1 --> Step2["Step 2: Generate Specification Object<br/>• Canonical Framework Resolved (Next.js, Svelte, Nuxt, Angular)<br/>• Validation commands formulated<br/>• Archetype layout directives applied"]

    Step2 --> Step3["Step 3: Framework-Native CLI Scaffolding<br/>• Next.js: pnpm create next-app@latest<br/>• Nuxt: pnpm dlx nuxi@latest init<br/>• Angular: pnpm dlx @angular/cli@latest new<br/>• SvelteKit: pnpm dlx sv create"]

    subgraph MandatoryInvariants ["Mandatory Konoha Layout Invariants"]
        I1["Brand Logo Far-Left<br/>(Never centered; actions on right)"]
        I2["Zero Mobile Header Toggle<br/>(No broken hamburger menu)"]
        I3["Archetype-Adaptive Mobile Dock<br/>(Fixed bottom navigation bar)"]
        I4["Fixed Left Sidebar (Desktop)<br/>(Dashboard / Admin / Infra builds)"]
        I5["Floating Theme Picker Modal<br/>(Bottom-right FAB, 10 palettes × Light/Dark)"]
        I6["Hero Banner Carousel<br/>(4+ HD slides, 5000ms autoplay)"]
        I7["Mandatory package.json Scripts<br/>('build', 'lint', 'start', 'check')"]
    end

    Step3 --> MandatoryInvariants
    MandatoryInvariants --> Step4["Step 4: Elite Implementation (♦ Jonin)<br/>• Semantic Tailwind CSS v4 styling<br/>• Reduced-motion accessible transitions<br/>• Pure Light Mode fidelity"]

    Step4 --> Step5["Step 5: Framework Validation Suite<br/>• pnpm run build ──► 0 Errors<br/>• pnpm run lint  ──► 0 Warnings<br/>• pnpm run check ──► Clean"]

    Step5 --> Step6["Step 6: Kage Two-Step Review Gate<br/>• 100/100 aislop scan<br/>• ≥ 98% Delivery Confidence"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style MandatoryInvariants fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef reqNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef scaffoldNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef invNode fill:#ffffff,stroke:#06b6d4,color:#0f172a,stroke-width:2px;
    classDef valNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef gateNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;

    class UserReq reqNode;
    class Step1,Step2,Step3,Step4 scaffoldNode;
    class I1,I2,I3,I4,I5,I6,I7 invNode;
    class Step5 valNode;
    class Step6 gateNode;
```

---

## 5. Workflow 4: Mockup / Design Image Build Pipeline (`build_from_source`)

```mermaid
---
title: Mockup & Design Image Build Pipeline (build_from_source)
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    SourceDesign["User Prompt with Design Images / Mockup Dir"] --> Step1["Step 1: MCP Call `konoha.build_from_source`<br/>(name, source_dir, framework, taste_dials)"]
    Step1 --> Step2["Step 2: Specification Validation<br/>• status == 'success'<br/>• absolute_image_paths extracted<br/>• Canonical framework verified"]

    Step2 --> Step3["Step 3: Bounded Asset Inspection<br/>• Inspect images via bounded file tools<br/>• Extract colors, typography, spacing &amp; layout<br/>• NEVER install packages inside MCP tool"]

    subgraph FidelityRule ["100% Exact Mockup Fidelity Invariant"]
        F1["Strict Visual Replication<br/>• Layout, colors, typography, and spacing"]
        F2["Zero Silent Structural Alterations<br/>• DO NOT force carousels or theme pickers<br/>unless explicitly present in mockup!"]
        F3["Non-Structural Polish Only<br/>• Taste-Skill applied strictly for smooth transitions"]
    end

    Step3 --> FidelityRule
    FidelityRule --> Step4["Step 4: Implementation (♦ Jonin)<br/>• Replicate source layout pixel-for-pixel<br/>• Framework-native component tree"]

    Step4 --> Step5["Step 5: Visual Verification (`agent-browser`)<br/>• Local rendering screenshot capture<br/>• Side-by-side design match audit"]

    Step5 --> Step6["Step 6: Framework Build Validation<br/>• pnpm run build &amp; lint pass cleanly<br/>• 0 Errors, 0 Warnings"]

    Step6 --> Step7["Step 7: Delivery Verification Gate"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style FidelityRule fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef startNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef processNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef ruleNode fill:#ffffff,stroke:#06b6d4,color:#0f172a,stroke-width:2px;
    classDef valNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef gateNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;

    class SourceDesign startNode;
    class Step1,Step2,Step3,Step4,Step5 processNode;
    class F1,F2,F3 ruleNode;
    class Step6 valNode;
    class Step7 gateNode;
```

---

## 6. Workflow 5: Two-Step Zero-AI-Slop Pre-Gate & Autonomous Remediation Loop

```mermaid
---
title: Two-Step Zero-AI-Slop Delivery Pre-Gate & Remediation Loop
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#f59e0b'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    Trigger["Pre-Delivery Review Gate Triggered"] --> Step1["Step 1: Mechanical Scan Gate<br/>• Run `aislop_scan` (or CLI `rtk aislop scan --changes`)<br/>• CircuitBreaker fail-safe degrade (recovery=120s)<br/>• Dynamic file mtime cache invalidation<br/>• TARGET: Exactly 100 / 100 Score, 0 Findings"]

    Step1 --> Step2["Step 2: Anti-Slop Rule Review<br/>• Load vendored `antislop` skill family<br/>• Audit code comments (zero syntax narration)<br/>• Audit implementations (zero lazy TODOs / stubs)<br/>• Audit accessibility (contrast, focus states)"]

    Step2 --> CheckSlop{"Any AI Slop<br/>Findings Found?"}

    CheckSlop -- "Zero Findings (100/100 Clean)" --> PassGate["Delivery Pre-Gate Passed<br/>• ai_slop_clean: true<br/>• ai_slop_findings: 0<br/>• Score: 100 / 100"]
    PassGate --> KageGate["Proceed to Kage Confidence Scoring<br/>(Target ≥ 98%)"]

    CheckSlop -- "Findings Detected" --> LoopInit["Increment slop_cycles Counter"]
    LoopInit --> CheckBreaker{"Circuit Breaker<br/>slop_cycles > 7?"}

    CheckBreaker -- "YES (> 7 cycles)" --> Tripped["TRIP CIRCUIT BREAKER<br/>• Halt autonomous recursion<br/>• Set status = 'blocked'<br/>• Surface findings to user"]

    CheckBreaker -- "NO (<= 7 cycles)" --> Triage["Autonomous Triage Engine<br/>(`src/sdlc_manager.js`)"]
    Triage --> CheckType{"Are findings<br/>UI / Frontend related?"}

    CheckType -- "YES" --> AssignJonin["Dispatch Fix Task to ♦ JONIN<br/>• Priority: High<br/>• Focus: CSS / Component / Tailwind fixes"]
    CheckType -- "NO" --> AssignAnbu["Dispatch Fix Task to ♠ ANBU<br/>• Priority: High<br/>• Focus: Backend / Logic / Clean Code fixes"]

    AssignJonin --> ReExecute["Execute Fixes, Re-run Tests &amp; Re-enter Gate"]
    AssignAnbu --> ReExecute
    ReExecute --> Step1

    linkStyle default stroke:#334155,stroke-width:2px;

    classDef triggerNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef gateNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef passNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef loopNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;
    classDef triageNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;

    class Trigger,Step1,Step2 triggerNode;
    class CheckSlop,CheckBreaker,CheckType gateNode;
    class PassGate,KageGate passNode;
    class LoopInit,Tripped loopNode;
    class Triage,AssignJonin,AssignAnbu,ReExecute triageNode;
```

---

## 7. Workflow 6: QA Automation & Token-Efficient E2E Validation Flow

```mermaid
---
title: Token-Efficient QA Automation Pipeline (♠ Anbu Owner)
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 350
---
flowchart LR
    Start["QA Task Ingestion"] --> S1["1. Test Discovery<br/>(Check tests/ &amp; prevent duplicates)"]
    S1 --> S2["2. Flow Recording<br/>(agent-browser captures JSON steps)"]
    S2 --> S3["3. Test Codification<br/>(qa_codify compiles Playwright spec)"]
    S3 --> S4["4. Headless Execution<br/>(qa_e2e_run runs Playwright test)"]
    S4 --> S5["5. Evidence Capping<br/>(Clean exit 0 &amp; output &lt; 2,000 chars)"]
    S5 --> S6["6. Persistence<br/>(Save run_id to SQLite sdlc_tasks)"]
    S6 --> Done["Kage Verification Sign-off"]

    linkStyle default stroke:#334155,stroke-width:2px;

    classDef stepNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef passNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;

    class Start,S1,S2,S3,S4,S5 stepNode;
    class S6,Done passNode;
```

---

## 8. Workflow 7: Skills Lifecycle, SQLite FTS5 & Cross-Client 5-Tree Synchronization

```mermaid
---
title: Skills Indexing, Retrieval & Cross-Client Synchronization Flow
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#8b5cf6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TB
    SourceTree["Canonical Source of Truth<br/>`.agents/skills/` (15 Canonical Skills + Embedded References)"] --> SyncScript["Additive Mirror Synchronization<br/>`node scripts/sync_skills.js`"]

    subgraph MirrorTrees ["Cross-Client 6-Tree Repository Mirrors"]
        M1["src/templates/skills/"]
        M2[".cursor/skills/"]
        M3[".gemini/skills/"]
        M4[".commandcode/skills/"]
        M5[".claude/skills/"]
        M6[".omp/skills/"]
    end

    SyncScript --> MirrorTrees

    SourceTree --> FTS5Migrate["SQLite FTS5 & Dense Vector Ingestion<br/>`src/migrate.js` (FTS5 BM25 + Granite RAG)"]
    FTS5Migrate --> SQLiteDB[("Unified Database: `~/.konoha/konoha.db`<br/>• skills (primary store: content, byte_size)<br/>• skills_fts (BM25 token index)<br/>• skill_chunks (384d semantic vectors)")]

    subgraph ClientQueries ["On-Demand Retrieval Pipeline (DB Primary, Mirror Fallback)"]
        Find["Step 1: Discover<br/>konoha.find_skill('keyword')<br/>(Primary SQLite FTS5 &amp; Vector RAG preview)"]
        Load["Step 2: Ingest<br/>konoha.use_skills / konoha.get_skill<br/>(Primary SQLite DB, disk mirror fallback)"]
    end

    SQLiteDB <--> Find
    Find --> Load

    subgraph AutoCompaction ["High-Efficiency Auto-Compaction (Turn >= 2)"]
        AC1["Project Memory Continuity<br/>(Tech stack &amp; invariants permanently retained)"]
        AC2["Prompt Boilerplate Compaction<br/>(Instruction boilerplate compressed)"]
        AC3["250-char SOP Preview Invariant<br/>(Always preserved even in compact mode)"]
    end

    Load --> AutoCompaction

    linkStyle default stroke:#334155,stroke-width:2px;
    style MirrorTrees fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style ClientQueries fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style AutoCompaction fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef sourceNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef mirrorNode fill:#ffffff,stroke:#06b6d4,color:#0f172a,stroke-width:2px;
    classDef dbNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef queryNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;

    class SourceTree,SyncScript sourceNode;
    class M1,M2,M3,M4,M5,M6 mirrorNode;
    class FTS5Migrate,SQLiteDB dbNode;
    class Find,Load,AC1,AC2,AC3 queryNode;
```

---

## 9. Workflow 8: Local LLM Proxy Bridge Gateway & Sidecar Binary RPC

```mermaid
---
title: Local LLM Proxy Bridge Gateway & Protobuf Sidecar Architecture
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#f59e0b'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TB
    Client["AI Coding Client<br/>(Antigravity IDE with konoha-bridge VSIX)"] --> OuterGateway["Local Bridge Router<br/>`127.0.0.1:1404` / :19999"]

    OuterGateway --> Intercept["Request Multiplexer &amp; Model Classifier<br/>• Maps model names from SQLite bridges table<br/>• Pure JavaScript routing (Zero native binaries)"]

    subgraph SidecarProtocol ["Sidecar Binary Serialization (`src/bridge/sidecar/proto.js`)"]
        ProtoEncoder["Protobuf Binary Serialization<br/>• Hand-crafted descriptors (StartCascade, Messages)<br/>• Uses @bufbuild/protobuf@2.16.0<br/>• Reads BUF_BIGINT_DISABLE for runtime fallback"]
    end

    Intercept --> ProtoEncoder

    subgraph ModelEndpoints ["Destination Providers"]
        CloudLLM["Upstream Cloud LLM<br/>(OpenAI / Gemini / Claude API)"]
        LocalLLM["Local Small Language Model<br/>(Ollama `127.0.0.1:11434`)"]
    end

    ProtoEncoder --> CloudLLM
    ProtoEncoder --> LocalLLM

    linkStyle default stroke:#334155,stroke-width:2px;
    style SidecarProtocol fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style ModelEndpoints fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef clientNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef routerNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef sidecarNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef destNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;

    class Client clientNode;
    class OuterGateway,Intercept routerNode;
    class ProtoEncoder sidecarNode;
    class CloudLLM,LocalLLM destNode;
```

---

## 10. Workflow 9: Socket.dev Supply Chain Security Gate & Policy Evaluation

```mermaid
---
title: Socket.dev Supply Chain Security Policy & Scan Workflow
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    Commit["Repository Commit / Pull Request"] --> Config["Load `socket.yml` Configuration<br/>(Repository-Level Policy)"]

    subgraph PolicyEngine ["Policy Filtering Rules"]
        Ignores["projectIgnorePaths<br/>• Exclude: tests, docs, apps/web, .agents<br/>• Scopes static scanner strictly to root manifest"]
        Rules["issueRules Override<br/>• envVars: false (Protobuf BUF_BIGINT_DISABLE)<br/>• urlStrings: false (Localhost / Docs / MCP ports)<br/>• networkAccess: false"]
    end

    Config --> PolicyEngine
    PolicyEngine --> SocketCI["Execute Socket Scan<br/>`rtk socket ci` / `socket scan create`"]

    SocketCI --> AuditAlerts{"Evaluate Alerts<br/>Against Threshold"}
    AuditAlerts -- "0 High &amp; 0 Medium Alerts" --> GatePass["Supply Chain Gate PASSED<br/>• Score Target ≥ 98 / 100<br/>• Approved for Production"]
    AuditAlerts -- "High or Medium Alert Detected" --> GateFail["BLOCK DELIVERY<br/>• Surface alert locations<br/>• Enforce dependency remediation"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style PolicyEngine fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef commitNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef policyNode fill:#ffffff,stroke:#06b6d4,color:#0f172a,stroke-width:2px;
    classDef evalNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef passNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef failNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;

    class Commit,Config,SocketCI commitNode;
    class Ignores,Rules policyNode;
    class AuditAlerts evalNode;
    class GatePass passNode;
    class GateFail failNode;
```

---

## 11. Workflow 10: Kage Reviewer 98% Minimum Confidence Delivery Gate

```mermaid
---
title: Kage Reviewer 98% Minimum Confidence Delivery Gate
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#f59e0b'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    TasksDone["All Implementation Tasks Completed"] --> KageAudit["◎ Kage Independent Audit Review"]

    subgraph CriteriaMatrix ["5-Category Comprehensive Verification Matrix"]
        C1["Category 1: Task Verification (Weight: 20%)<br/>• 100% tasks completed in status.json<br/>• All referenced files exist on disk"]
        C2["Category 2: Validation Evidence (Weight: 25%)<br/>• 0 errors, 0 warnings in test output<br/>• Clean exit codes across test runners"]
        C3["Category 3: Security &amp; Supply Chain (Weight: 20%)<br/>• Socket CLI: 0 High, 0 Medium alerts<br/>• Documented rollback procedures"]
        C4["Category 4: Zero-AI-Slop Pre-Gate (Weight: 20%)<br/>• Step 1: 100/100 mechanical scan score<br/>• Step 2: 0 antislop rule findings"]
        C5["Category 5: Invariant Compliance (Weight: 15%)<br/>• Stable Bridge Gateway untouched<br/>• Token Savings flow logic preserved"]
    end

    KageAudit --> CriteriaMatrix
    CriteriaMatrix --> Aggregate["Aggregate Overall Confidence Score<br/>Confidence = Sum(Category Confidences * Weights)"]

    Aggregate --> ConfidenceThreshold{"Is Confidence Score<br/>≥ 98.0%?"}

    ConfidenceThreshold -- "Confidence >= 98.0%" --> Approved["DELIVERY APPROVED<br/>• Render Box Header Banner<br/>• Output Structured Score Breakdown<br/>• Complete Synthesis Phase (✧ Sannin)"]

    ConfidenceThreshold -- "Confidence < 98.0%" --> Blocked["DELIVERY BLOCKED<br/>• Reject final synthesis<br/>• Re-dispatch failed categories for remediation<br/>• Re-run verification upon resubmission"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style CriteriaMatrix fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef auditNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef criteriaNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef evalNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef passNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef blockNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;

    class TasksDone,KageAudit auditNode;
    class C1,C2,C3,C4,C5 criteriaNode;
    class Aggregate,ConfidenceThreshold evalNode;
    class Approved passNode;
    class Blocked blockNode;
```

---

## 12. Workflow 11: Telegram Remote Reporter & Whitelisted Long Polling Dispatch

```mermaid
---
title: Telegram Remote Reporter & Whitelisted Long Polling Dispatch
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#0284c7'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    subgraph OutboundReporting ["Outbound Task Status Reporter (src/telegram/notifier.js)"]
        SDLCEvent["SDLC Task Event<br/>(Task Completed / Failed / Queued)"] --> FormatReport["Format Zero-Emoji Notice<br/>• [KONOHA TASK REPORT]<br/>• Status: [SUCCESS] / [FAILED] / [QUEUED]<br/>• Duration, Agent, Evidence summary"]
        FormatReport --> CheckEnabled{"telegram_config<br/>enabled == 1?"}
        CheckEnabled -- "Yes" --> PostTelegram["HTTPS POST api.telegram.org<br/>/bot&lt;TOKEN&gt;/sendMessage<br/>to authorized chat_id"]
        CheckEnabled -- "No" --> SilentSkip["Silent No-Op<br/>(Telemetry preserved locally)"]
    end

    subgraph InboundLongPolling ["Inbound Long Polling Daemon (src/telegram/poller.js)"]
        PollerLoop["Native HTTPS Poller Loop<br/>GET /getUpdates?offset=N&amp;timeout=30"] --> UserMessage["User Message Received<br/>from Telegram Client"]
        UserMessage --> WhitelistCheck{"Is message.chat.id ==<br/>telegram_config.chat_id?"}
        WhitelistCheck -- "No" --> DropMsg["Drop Message &amp; Log Warning<br/>(Unauthorized sender rejected)"]
        WhitelistCheck -- "Yes" --> CommandRouter{"Message Type"}

        CommandRouter -- "/session [number|create]" --> SessionSwitch["Multi-Client Switcher<br/>(session_manager.js)"]
        CommandRouter -- "/sh &lt;cmd&gt;" --> ShellExec["Security Hardening Notice<br/>• /sh removed in v2.2.1<br/>• Replaced by /run pipeline"]
        CommandRouter -- "/kage, /anbu, /jonin..." --> SubagentDispatch["Direct Subagent Dispatch<br/>Enqueue prompt_queue"]
        CommandRouter -- "/run &lt;prompt&gt; | text" --> QueueEnqueue["Enqueue into prompt_queue<br/>(source: 'telegram')"]
        CommandRouter -- "/status" --> ReplyStatus["Reply with Active Daemon &amp; Task State"]
        CommandRouter -- "/savings" --> ReplySavings["Reply with Byte-Weighted Token Savings"]
        CommandRouter -- "/cancel" --> ReplyCancel["Cancel Active Queued Task"]
        CommandRouter -- "/help" --> ReplyHelp["Reply with Command Reference"]

        QueueEnqueue --> SendAck["Send Telegram Reply:<br/>[KONOHA TASK QUEUED] ID: &lt;ID&gt;"]
        SubagentDispatch --> SendAck
        QueueEnqueue --> QueueWorker["Autonomous Worker (worker.js)<br/>• Operational: 0 LLM Tokens<br/>• AI Coding: agy -p (Kage Gate)"]
    end

    linkStyle default stroke:#334155,stroke-width:2px;
    style OutboundReporting fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style InboundLongPolling fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef eventNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef routeNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef checkNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef passNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef dropNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;

    class SDLCEvent,FormatReport,UserMessage eventNode;
    class SessionSwitch,ShellExec,SubagentDispatch,QueueEnqueue,ReplyStatus,ReplySavings,ReplyCancel,ReplyHelp,QueueWorker routeNode;
    class CheckEnabled,WhitelistCheck,CommandRouter checkNode;
    class PostTelegram,SendAck passNode;
    class SilentSkip,DropMsg dropNode;
```

---

## 13. Workflow 12: Cloudflare Zero Trust Ingress Tunnel & Unified Prompt Inbox Queue

```mermaid
---
title: Cloudflare Zero Trust Ingress Tunnel & Unified Prompt Inbox Queue
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#8b5cf6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    subgraph EdgeIngress ["Cloudflare Zero Trust Edge & Tunnel Supervisor"]
        ExtClient["Remote Browser / Mobile Client"] --> CFEdge["Cloudflare Zero Trust Edge Access<br/>(OAuth / SSO Identity Gate)"]
        CFEdge --> CFTunnel["Encrypted QUIC / HTTP2 Tunnel<br/>cloudflared tunnel --url http://localhost:1404"]
        CFTunnel --> LocalSupervisor["Tunnel Supervisor (src/tunnel/manager.js)<br/>• PID &amp; Process Monitoring<br/>• Public URL Extraction (*.trycloudflare.com)"]
    end

    subgraph SecurityGate ["Ingress Security Validation (src/tunnel/security.js)"]
        LocalSupervisor --> WebServer["Konoha Web Server (Port 1404)<br/>GET/POST /api/v1/* &amp; UI Routes"]
        WebServer --> ModeCheck{"Request Origin &amp; Auth Mode"}
        ModeCheck -- "Localhost (127.0.0.1)" --> AllowDirect["Allow Direct Access<br/>(Zero friction local dev)"]
        ModeCheck -- "Tunnel Ingress (Named tunnel: Zero Trust)" --> EdgeHeaderCheck{"Valid CF-Access-Jwt-Assertion<br/>or Authenticated-User-Email?"}
        EdgeHeaderCheck -- "Yes" --> Authenticated["Authenticated Request<br/>Identity injected into req.user"]
        EdgeHeaderCheck -- "No" --> DenyAccess["401 Unauthorized<br/>PIN / Edge Identity Required"]
        ModeCheck -- "Tunnel Ingress (Quick tunnel or no edge identity)" --> PinCheck{"Constant-time auth_pin<br/>x-konoha-pin / bearer / cookie?"}
        PinCheck -- "Valid PIN" --> Authenticated
        PinCheck -- "Invalid PIN" --> DenyAccess
    end

    subgraph PromptQueueLifecycle ["Unified Prompt Queue Engine (src/queue/inbox.js)"]
        Authenticated --> SubmitPrompt["POST /api/v1/queue/prompts<br/>Prompt payload + task context"]
        AllowDirect --> SubmitPrompt
        SubmitPrompt --> SQLiteInsert[("Insert SQLite prompt_queue<br/>• status: 'pending'<br/>• source: 'remote_ui' | 'telegram'<br/>• priority: 0, retry_count: 0")]
        SQLiteInsert --> FileMirror["Atomic Mirror Write<br/>• ~/.konoha/inbox/&lt;session_id&gt;.json<br/>• ~/.konoha/inbox/latest.json"]
        FileMirror --> ClientPickup["Coding Client Pickup / Polling<br/>(Antigravity · Cursor · Claude · OpenCode)"]
        ClientPickup --> MarkProcessing["Update Status: 'processing'"]
        MarkProcessing --> MarkCompleted["Update Status: 'completed' / 'failed'"]
        MarkCompleted --> RemoteDashboard["Real-Time Remote Access UI<br/>(apps/web/src/components/RemoteAccess.svelte)"]
    end

    linkStyle default stroke:#334155,stroke-width:2px;
    style EdgeIngress fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style SecurityGate fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style PromptQueueLifecycle fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef clientNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef edgeNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef authNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef storageNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef denyNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;

    class ExtClient,ClientPickup clientNode;
    class CFEdge,CFTunnel,LocalSupervisor,WebServer edgeNode;
    class ModeCheck,EdgeHeaderCheck,PinCheck authNode;
    class AllowDirect,Authenticated,SubmitPrompt,SQLiteInsert,FileMirror,MarkProcessing,MarkCompleted,RemoteDashboard storageNode;
    class DenyAccess denyNode;
```

---

## 14. Workflow 13: Native Document Engineering & Animated WebP Export Pipeline

```mermaid
---
title: Native Document Engineering & Animated WebP Export Pipeline
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    subgraph RequestRouting ["Tokubetsu-Jonin Technical Scribe Dispatch"]
        UserReq["User Prompt / Technical Deliverable Request"] --> TJ["Tokubetsu-Jonin Scribe Subagent<br/>(src/mcp/tool_dispatch.js)"]
        TJ --> RouteCheck{"Deliverable Type?"}
    end

    subgraph OfficePipeline ["Office Document Generation (src/tools/document_engine.js)"]
        RouteCheck -- "DOCX / PDF" --> DocCreate["document_create()<br/>• 4 Generative Cover Art Models<br/>• Discrete per-page Word sections<br/>• Static TextRun page numbers (No grey shading)"]
        RouteCheck -- "Spreadsheet XLSX" --> SheetCreate["spreadsheet_create()<br/>• 10 Curated Palettes<br/>• Summary KPI Cards + Formulas<br/>• Auto-Fit Column Widths"]
        RouteCheck -- "Presentation PPTX" --> PresCreate["presentation_create()<br/>• 16:9 Widescreen Layouts<br/>• Pure Light Mode &amp; Gradient Accent Slides"]
        DocCreate --> ZeroGPTCheck{"Document AI Detector<br/>(docs_ai_detector)"}
        ZeroGPTCheck -- "Burstiness CV &gt;= 0.85" --> AIDetectorPass["Score Verified: &lt; 3% ZeroGPT Risk<br/>Zero AI Fingerprints"]
    end

    subgraph AnimationPipeline ["Native Diagram &amp; Animated WebP Pipeline"]
        RouteCheck -- "SVG Diagram" --> DiagCreate["diagram_create()<br/>• Dual Orientation: LR (Horizontal) / TB (Vertical)<br/>• 10 Curated 4-Color Gradient Themes<br/>• Pure White Card Layout &amp; Animated SMIL Dashes"]
        DiagCreate --> AnimExport["animation_export()<br/>Canonical Target: output.webp"]
        AnimExport --> PWCapture["Playwright Chromium Headless<br/>• Advance SMIL timeline per frame (15fps)<br/>• Deterministic CSS strokeDashoffset scrub<br/>• High-DPI frame capture to tmpdir"]
        PWCapture --> EncoderChoice{"Requested Output Format?"}
        EncoderChoice -- "Canonical: webp" --> LibWebPAnim["FFmpeg libwebp_anim Encoder<br/>-vcodec libwebp_anim -compression_level 6<br/>-q:v 50 -preset drawing -loop 0"]
        EncoderChoice -- "Compatibility: gif" --> GifEncoder["FFmpeg PaletteGen / PaletteUse<br/>-vf palettegen=max_colors=128;paletteuse"]
        EncoderChoice -- "Static Fallback / Error" --> StaticFallback["Static PNG Fallback<br/>(frame_0000.png high-DPI snapshot)"]
        LibWebPAnim --> WebPValidator["Binary WebP Structural Validator<br/>(validateAnimatedWebP)<br/>• RIFF/WEBP Bitstream Header<br/>• VP8X Animation Flag Check<br/>• ANIM Loop Count (0 = Infinite)<br/>• ANMF Frame Chunk Count &amp; Timing"]
        WebPValidator -- "Valid Animation Structure" --> WebPVerified["PASS: Validated Animated WebP<br/>(40-70% size reduction over GIF)"]
        WebPValidator -- "Validation Failed" --> AutoCleanup["Cleanup Temp Frames &amp; Return Diagnostic"]
    end

    subgraph Deliverables ["Production Technical Deliverable Handoff"]
        AIDetectorPass --> FinalHandoff["Deliver Production Deliverable<br/>• Structured JSON Metadata<br/>• Local File Output Path"]
        SheetCreate --> FinalHandoff
        PresCreate --> FinalHandoff
        WebPVerified --> FinalHandoff
        GifEncoder --> FinalHandoff
        FinalHandoff --> TJ
        TJ --> SanninSynthesize["Sannin Synthesis &amp; User Delivery<br/>(100% Local Verification · Zero Remote Push)"]
    end

    linkStyle default stroke:#334155,stroke-width:2px;
    style RequestRouting fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style OfficePipeline fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style AnimationPipeline fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;
    style Deliverables fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#0f172a;

    classDef clientNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef officeNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef animNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef validNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;
    classDef failNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;

    class UserReq,TJ,SanninSynthesize clientNode;
    class DocCreate,SheetCreate,PresCreate,ZeroGPTCheck officeNode;
    class DiagCreate,AnimExport,PWCapture,LibWebPAnim,GifEncoder,WebPValidator,EncoderChoice animNode;
    class AIDetectorPass,WebPVerified,FinalHandoff validNode;
    class AutoCleanup,StaticFallback failNode;
```
