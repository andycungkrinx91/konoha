# 🌊 Konoha Complete Workflows Architecture & Flow Diagrams

This document defines all active architectural workflows within **Konoha** (`konoha-mcp`) using native, responsive, and publication-ready **Mermaid** diagrams rendered in the canonical **Tokubetsu-Jonin Light Design Standard** (pure white canvas `#FFFFFF`, dark slate typography `#0F172A`, unified 4-color gradient-wash shapes across blue, orange, green, and red, and zero dark backgrounds).

---

## 📑 Table of Contents

1. [Master Orchestration Architecture & Client-Specialist Flow](#1-master-orchestration-architecture--client-specialist-flow)
2. [Workflow 1: Core Multi-Agent MCP SDLC Orchestration Pipeline](#2-workflow-1-core-multi-agent-mcp-sdlc-orchestration-pipeline)
3. [Workflow 2: Definition-of-Readiness (DoR) Gate & Dispatch Flow](#3-workflow-2-definition-of-readiness-dor-gate--dispatch-flow)
4. [Workflow 3: Text-Based Website Build Pipeline (`build_from_text`)](#4-workflow-3-text-based-website-build-pipeline-build_from_text)
5. [Workflow 4: Mockup / Design Image Build Pipeline (`build_from_source`)](#5-workflow-4-mockup--design-image-build-pipeline-build_from_source)
6. [Workflow 5: Two-Step Zero-AI-Slop Pre-Gate & Autonomous Remediation Loop](#6-workflow-5-two-step-zero-ai-slop-pre-gate--autonomous-remediation-loop)
7. [Workflow 6: QA Automation & Token-Efficient E2E Validation Flow](#7-workflow-6-qa-automation--token-efficient-e2e-validation-flow)
8. [Workflow 7: Skills Lifecycle, SQLite FTS5 & Cross-Client Skill Deployment](#8-workflow-7-skills-lifecycle-sqlite-fts5--cross-client-skill-deployment)
9. [Workflow 8: Local LLM Proxy Bridge Gateway & Sidecar Binary RPC](#9-workflow-8-local-llm-proxy-bridge-gateway--sidecar-binary-rpc)
10. [Workflow 9: Socket.dev Supply Chain Security Gate & Policy Evaluation](#10-workflow-9-socketdev-supply-chain-security-gate--policy-evaluation)
11. [Workflow 10: Kage Reviewer 98% Minimum Confidence Delivery Gate](#11-workflow-10-kage-reviewer-98-minimum-confidence-delivery-gate)
12. [Workflow 11: Telegram Remote Reporter & Whitelisted Long Polling Dispatch](#12-workflow-11-telegram-remote-reporter--whitelisted-long-polling-dispatch)
13. [Workflow 12: Unified Prompt Inbox Queue & Governed Agent Dispatch Pipeline](#13-workflow-12-unified-prompt-inbox-queue--governed-agent-dispatch-pipeline)
14. [Workflow 13: Native Document Engineering & Animated WebP Export Pipeline](#14-workflow-13-native-document-engineering--animated-webp-export-pipeline)
15. [Workflow 14: Akatsuki Security Controls & Dual-Mode Lab Lifecycle](#15-workflow-14-akatsuki-security-controls--dual-mode-lab-lifecycle)
16. [Workflow 15: LangGraph.js Production State Graph & Error Edge Circuit Breaker](#16-workflow-15-langgraphjs-production-state-graph--error-edge-circuit-breaker)
17. [Workflow 16: Turn-Scoped Budget Execution & Resume Loop Protocol](#17-workflow-16-turn-scoped-budget-execution--resume-loop-protocol)
18. [Workflow 17: Text-to-3D Generation Pipeline (Yamanaka Graph)](#18-workflow-17-text-to-3d-generation-pipeline-yamanaka-graph)
19. [Workflow 18: Image-to-3D Upload, Relief Mesh & Blender Refinement Pipeline](#19-workflow-18-image-to-3d-upload-relief-mesh--blender-refinement-pipeline)

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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
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
    Clients --> Orchestrator["Main Orchestrator Agent<br/>(LangGraph.js Production StateGraph Router)"]

    subgraph CoreMCP ["Konoha MCP & Storage Foundation"]
        SanninRouter["✧ Sannin MCP Router<br/>(Prompt Triage &amp; Delegation)"]
        SQLiteDB[("Unified SQLite DB<br/>~/.konoha/konoha.db<br/>(FTS5 · WAL Mode · busy_timeout=5000)")]
        CodeIntel["Native Code Intelligence<br/>(code_index · code_search · code_symbol · code_context · code_impact · code_related · code_status · code_remove · AST + FTS5 + Granite)"]
        AislopScanner["Aislop MCP Server<br/>(Zero-AI-Slop Code Hygiene)"]
        SanninRouter <--> SQLiteDB
        CodeIntel <--> SQLiteDB
    end

    Orchestrator --> CoreMCP

    subgraph NinjaTeam ["Specialist Ninja Subagents"]
        Sannin["✧ sannin<br/>(Village Router &amp; Planner)"]
        Genin["⚑ genin<br/>(Read-only Code Scout)"]
        Kage["◎ kage<br/>(Architecture &amp; Quality Gates)"]
        Chunin["▫ chunin<br/>(Web Intel &amp; Citations)"]
        Jonin["♦ jonin<br/>(Frontend UI &amp; Tailwind)"]
        Anbu["♠ anbu<br/>(Backend, DevOps &amp; QA)"]
        Tokubetsu["⬡ tokubetsu-jonin<br/>(Documentation Scribe)"]
        Akatsuki["🛡️ akatsuki<br/>(Security Specialist · Blue SAST / Red Lab)"]
        Yamanaka["❖ yamanaka<br/>(Generative 3D &amp; Spatial Subsystem)"]
    end

    CoreMCP --> NinjaTeam

    subgraph QualityGate ["Verification & Quality Enforcement"]
        DoRGate["Definition-of-Readiness Gate<br/>(Advisory / Enforced Check)"]
        AkatsukiSecurityGate["Akatsuki Blue-Team Security Gate<br/>(SAST · 0 High/Crit CVEs · Skill Guardian)"]
        SlopGate["Two-Step Zero-AI-Slop Gate<br/>(100/100 Mechanical Scan)"]
        SocketGate["Socket.dev Security Gate<br/>(0 High / 0 Medium Alerts)"]
        ConfidenceGate["Kage 98% Confidence Gate<br/>(Delivery Sign-off)"]
    end

    NinjaTeam --> QualityGate
    QualityGate --> Delivery["Final Delivery &amp; User Response<br/>(Structured Confidence Report)"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style CoreMCP fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style NinjaTeam fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style QualityGate fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef clientNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef mcpNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef agentNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef gateNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;

    class UserPrompt,Clients,Orchestrator,Delivery clientNode;
    class SanninRouter,SQLiteDB,CodeIntel,AislopScanner mcpNode;
    class Sannin,Genin,Kage,Chunin,Jonin,Anbu,Tokubetsu,Akatsuki,Yamanaka agentNode;
    class DoRGate,AkatsukiSecurityGate,SlopGate,SocketGate,ConfidenceGate gateNode;
```

---

## 2. Workflow 1: Core Multi-Agent MCP SDLC Orchestration Pipeline

```mermaid
---
title: Core Multi-Agent MCP SDLC Lifecycle, LangGraph Nodes & Akatsuki Security Gate
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    Init["Prompt Ingestion"] --> Phase0["Phase 0: ROUTE — node_classify (✧ Sannin &amp; LangGraph StateGraph)<br/>• LangGraph.js Production Orchestrator<br/>• Per-Turn Budget Governor (8k default)<br/>• Node Guard &amp; Circuit Breaker"]
    Phase0 --> Phase1["Phase 1: EXPLORE (⚑ Genin, inside node_dispatch)<br/>• Read-only symbol discovery<br/>• Map blast radius &amp; dependencies<br/>• Structured report_from_agent payload"]
    Phase1 --> Phase2["Phase 2: PLAN — node_plan (◎ Kage)<br/>• Evaluate architecture &amp; trade-offs<br/>• Formulate contracted task checklist<br/>• Register tasks in sdlc_tasks"]

    Phase2 --> Gate1["GATE 1: PLAN APPROVAL — node_plan returns __end__<br/>• Authoritative pending_plan_approval<br/>• Compact &amp; approve / Reject &amp; Regenerate"]
    Gate1 --> CheckResearch{"External Intel<br/>Required?"}
    CheckResearch -- "needs_research: true" --> Phase2b["Phase 2b: RESEARCH (▫ Chunin)<br/>• Web search &amp; official doc extraction<br/>• Return citations via structured report"]
    Phase2b --> Gate2A["Phase 3a: BRIEF — node_brief · Phase 3b: TODO — node_todo"]
    CheckResearch -- "needs_replan: true" --> Phase2
    CheckResearch -- "Approved to execute" --> Gate2A
    Gate2A --> Phase3["Phase 3c: EXECUTE — node_dispatch / node_execute (♦ Jonin / ♠ Anbu)<br/>• node_dispatch delegates, node_execute runs edits<br/>• Jonin: UI · Anbu: Backend/DevOps/QA<br/>• Framework build &amp; validation commands"]

    Phase3 --> Phase4["Phase 4: DOCUMENT (⬡ Tokubetsu-Jonin, phase === 'document' loops back to node_dispatch)<br/>• Return documentation deliverables<br/>• AI detection threshold &lt; 3.0%"]
    Phase4 --> Phase5["Phase 5: REVIEW — node_review (◎ Kage, 🛡️ Akatsuki &amp; @advisor)<br/>• LangGraph node_review &amp; runAislopGate (100/100)<br/>• Akatsuki Blue-Team Security Gate (SAST, CVEs, Secrets)<br/>• Socket.dev Supply Chain Gate<br/>• Definition-of-Done &amp; @advisor Evaluation"]

    Phase5 --> CheckReview{"Security, Slop &amp; Confidence<br/>Review Approved?"}
    CheckReview -- "gateVerdict: pass → node_complete" --> Phase6["Phase 6: COMPLETE / SYNTHESIZE (✧ Sannin)<br/>• Assemble final_report.md<br/>• GATE 2 pause point: node_review returns __end__ with pending_human_signoff<br/>• Resume at node_review to consume the human decision"]
    Phase6 --> Phase7["Phase 7: DONE<br/>• Clean transient scratch directories<br/>• Present final deliverable to user"]

    CheckReview -- "gateVerdict: remediate (or unknown)" --> Remediation["node_remediate Remediation Loop<br/>• Convert findings &amp; feedback into fix tasks<br/>• Circuit Breaker check (cycles &lt;= 7)<br/>• Error edge routing to node_error on cap exceed<br/>• Returns to node_dispatch, not node_execute"]
    Remediation --> Phase3

    linkStyle default stroke:#334155,stroke-width:2px;

    classDef routeNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef executeNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef reviewNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef failNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;
    classDef passNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;

    class Init,Phase0,Phase7 routeNode;
    class Phase1,Phase2,Phase2b,Gate2A,Phase3,Phase4,Phase6 executeNode;
    class Phase5,CheckReview,CheckResearch,Gate1 reviewNode;
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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    Trigger["Task Dispatch Trigger"] --> Inspect["Inspect Task Definition<br/>(title, prompt, context, parameters)"]
    Inspect --> Engine["DoR Assessment Engine<br/>(`src/workflow/kage-reviewer/sdlc_manager.js`)"]

    subgraph AssessmentRules ["Multi-Rule Verification Engine"]
        R1["Length &amp; Context Rule<br/>• Prompt &gt; 4 words<br/>• Explicit functional directive"]
        R2["Placeholder Hygiene<br/>• Zero unresolved placeholders<br/>• No incomplete pseudocode"]
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
    style AssessmentRules fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef triggerNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef ruleNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef passNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef blockNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;
    classDef evalNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;

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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
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

    subgraph MandatoryInvariants ["Project-Specific Design Invariants"]
        I1["Design Brief Authored First<br/>(9 fields, domain-derived)"]
        I2["Navigation Pattern From The Brief<br/>(menu / inline / bar / dock)"]
        I3["Theme Strategy From The Brief<br/>(single or dual)"]
        I4["Composition From IA<br/>(no fixed sections or archetype list)"]
        I5["Anti-Template Gate<br/>(no unrequested commerce/SaaS blocks)"]
        I6["Konoha Signature<br/>(generator meta + footer)"]
        I7["Mandatory package.json Scripts<br/>('build', 'lint', 'start', 'check')"]
    end

    Step3 --> MandatoryInvariants
    MandatoryInvariants --> Step4["Step 4: Elite Implementation (♦ Jonin)<br/>• Project tokens from the design brief<br/>• Reduced-motion accessible transitions<br/>• Brief-derived art direction"]

    Step4 --> Step5["Step 5: Framework Validation Suite<br/>• pnpm run build ──► 0 Errors<br/>• pnpm run lint  ──► 0 Warnings<br/>• pnpm run check ──► Clean"]

    Step5 --> Step6["Step 6: Kage Two-Step Review Gate<br/>• 100/100 aislop scan<br/>• ≥ 98% Delivery Confidence"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style MandatoryInvariants fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef reqNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef scaffoldNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef invNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef valNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef gateNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;

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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
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

    Step4 --> Step5["Step 5: Visual Verification (Playwright)<br/>• Local rendering screenshot capture<br/>• Side-by-side design match audit"]

    Step5 --> Step6["Step 6: Framework Build Validation<br/>• pnpm run build &amp; lint pass cleanly<br/>• 0 Errors, 0 Warnings"]

    Step6 --> Step7["Step 7: Delivery Verification Gate"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style FidelityRule fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef startNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef processNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef ruleNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef valNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef gateNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;

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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
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

    Step1 --> Step2["Step 2: Anti-Slop Rule Review<br/>• Load vendored `antislop` skill family<br/>• Audit code comments (zero syntax narration)<br/>• Audit implementations (zero lazy placeholders)<br/>• Audit accessibility (contrast, focus states)"]

    Step2 --> CheckSlop{"Any AI Slop<br/>Findings Found?"}

    CheckSlop -- "Zero Findings (100/100 Clean)" --> PassGate["Delivery Pre-Gate Passed<br/>• ai_slop_clean: true<br/>• ai_slop_findings: 0<br/>• Score: 100 / 100"]
    PassGate --> KageGate["Proceed to Kage Confidence Scoring<br/>(Target ≥ 98%)"]

    CheckSlop -- "Findings Detected" --> LoopInit["Increment slop_cycles Counter"]
    LoopInit --> CheckBreaker{"Circuit Breaker<br/>slop_cycles > 7?"}

    CheckBreaker -- "YES (> 7 cycles)" --> Tripped["TRIP CIRCUIT BREAKER<br/>• Halt autonomous recursion<br/>• Set status = 'blocked'<br/>• Surface findings to user"]

    CheckBreaker -- "NO (<= 7 cycles)" --> Triage["Autonomous Triage Engine<br/>(`src/workflow/kage-reviewer/sdlc_manager.js`)"]
    Triage --> CheckType{"Are findings<br/>UI / Frontend related?"}

    CheckType -- "YES" --> AssignJonin["Dispatch Fix Task to ♦ JONIN<br/>• Priority: High<br/>• Focus: CSS / Component / Tailwind fixes"]
    CheckType -- "NO" --> AssignAnbu["Dispatch Fix Task to ♠ ANBU<br/>• Priority: High<br/>• Focus: Backend / Logic / Clean Code fixes"]

    AssignJonin --> ReExecute["Execute Fixes, Re-run Tests &amp; Re-enter Gate"]
    AssignAnbu --> ReExecute
    ReExecute --> Step1

    linkStyle default stroke:#334155,stroke-width:2px;

    classDef triggerNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef gateNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef passNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef loopNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;
    classDef triageNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;

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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart LR
    Start["QA Task Ingestion"] --> S1["1. Test Discovery<br/>(Check tests/ &amp; prevent duplicates)"]
    S1 --> S2["2. Flow Recording<br/>(Playwright captures JSON steps)"]
    S2 --> S3["3. Test Codification<br/>(qa_codify compiles Playwright spec)"]
    S3 --> S4["4. Headless Execution<br/>(qa_e2e_run runs Playwright test)"]
    S4 --> S5["5. Evidence Capping<br/>(Clean exit 0 &amp; output &lt; 2,000 chars)"]
    S5 --> S6["6. Persistence<br/>(Save run_id to SQLite sdlc_tasks)"]
    S6 --> Done["Kage Verification Sign-off"]

    linkStyle default stroke:#334155,stroke-width:2px;

    classDef stepNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef passNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;

    class Start,S1,S2,S3,S4,S5 stepNode;
    class S6,Done passNode;
```

---

## 8. Workflow 7: Skills Lifecycle, SQLite FTS5 & Cross-Client Skill Deployment

```mermaid
---
title: Skills Indexing, Retrieval & Cross-Client Synchronization Flow
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TB
    SourceTree["Canonical Source of Truth<br/>`src/templates/skills/` (17 Canonical Skills + Embedded References)"] --> SyncScript["Additive Mirror Synchronization<br/>`node scripts/sync_skills.js`"]

    subgraph MirrorTrees ["Deployed Skill Roots (repository mirror trees are pruned)"]
        M1["~/.agents/skills/ (harness-neutral, gitignored as a deployed mirror)"]
        M2["~/.cursor  ~/.gemini  ~/.gemini/antigravity-cli"]
        M3["~/.commandcode  ~/.claude  ~/.opencode"]
        M4["~/.config/opencode  ~/.codex  ~/.omp/agent  ~/.pi/agent"]
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
    style MirrorTrees fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style ClientQueries fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style AutoCompaction fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef sourceNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef mirrorNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef dbNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef queryNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;

    class SourceTree,SyncScript sourceNode;
    class M1,M2,M3,M4 mirrorNode;
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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
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
    style SidecarProtocol fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style ModelEndpoints fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef clientNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef routerNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef sidecarNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef destNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;

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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
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
    style PolicyEngine fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef commitNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef policyNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef evalNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef passNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef failNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    TasksDone["All Implementation Tasks Completed"] --> AkatsukiGate["🛡️ Akatsuki Blue-Team Security Review Gate<br/>• SAST analysis on modified files<br/>• Secrets &amp; credentials leakage scan<br/>• Dependency CVEs (0 High / 0 Critical)<br/>• Skill Guardian policy verification"]
    
    AkatsukiGate -->|Security Cleared: security_reviewed=true| KageAudit["◎ Kage Independent Audit Review"]
    AkatsukiGate -->|Security Findings Detected| BlockedSec["SECURITY BLOCKED<br/>• Re-dispatch remediation to Anbu/Jonin<br/>• Require clean security re-scan"]

    subgraph CriteriaMatrix ["5-Category Comprehensive Verification Matrix"]
        C1["Category 1: Task Verification (Weight: 20%)<br/>• 100% tasks completed in status.json<br/>• All referenced files exist on disk"]
        C2["Category 2: Validation Evidence (Weight: 25%)<br/>• 0 errors, 0 warnings in test output<br/>• Clean exit codes across test runners"]
        C3["Category 3: Security &amp; Supply Chain (Weight: 20%)<br/>• Akatsuki Blue-Team security clearance<br/>• Socket CLI: 0 High, 0 Medium alerts<br/>• Documented rollback procedures"]
        C4["Category 4: Zero-AI-Slop Pre-Gate (Weight: 20%)<br/>• Step 1: 100/100 mechanical scan score<br/>• Step 2: 0 antislop rule findings"]
        C5["Category 5: Invariant Compliance (Weight: 15%)<br/>• Stable Bridge Gateway untouched<br/>• Token Savings flow logic preserved"]
    end

    KageAudit --> CriteriaMatrix
    CriteriaMatrix --> Aggregate["Aggregate Overall Confidence Score<br/>Confidence = Sum(Category Confidences * Weights)"]

    Aggregate --> ConfidenceThreshold{"Is Confidence Score<br/>≥ 98.0%?"}

    ConfidenceThreshold -- "Confidence >= 98.0%" --> Approved["DELIVERY APPROVED<br/>• Render Box Header Banner<br/>• Output Structured Score Breakdown<br/>• Complete Synthesis Phase (✧ Sannin)"]

    ConfidenceThreshold -- "Confidence < 98.0%" --> Blocked["DELIVERY BLOCKED<br/>• Reject final synthesis<br/>• Re-dispatch failed categories for remediation<br/>• Re-run verification upon resubmission"]

    linkStyle default stroke:#334155,stroke-width:2px;
    style CriteriaMatrix fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef auditNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef criteriaNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef evalNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef passNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef blockNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

    class TasksDone,KageAudit,AkatsukiGate auditNode;
    class C1,C2,C3,C4,C5 criteriaNode;
    class Aggregate,ConfidenceThreshold evalNode;
    class Approved passNode;
    class Blocked,BlockedSec blockNode;
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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
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
    style OutboundReporting fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style InboundLongPolling fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef eventNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef routeNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef checkNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef passNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef dropNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

    class SDLCEvent,FormatReport,UserMessage eventNode;
    class SessionSwitch,ShellExec,SubagentDispatch,QueueEnqueue,ReplyStatus,ReplySavings,ReplyCancel,ReplyHelp,QueueWorker routeNode;
    class CheckEnabled,WhitelistCheck,CommandRouter checkNode;
    class PostTelegram,SendAck passNode;
    class SilentSkip,DropMsg dropNode;
```

---

## 13. Workflow 12: Unified Prompt Inbox Queue & Governed Agent Dispatch Pipeline

```mermaid
---
title: Unified Prompt Inbox Queue & Governed Agent Dispatch Pipeline
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    subgraph IngressLayer ["Ingress Layer (Local HTTP & Telegram Bot)"]
        WebClient["Web UI Dashboard Operator<br/>(http://127.0.0.1:1404)"] --> WebServer["Konoha Web Server<br/>POST /api/v1/queue/prompts"]
        TgUser["Authorized Telegram Operator"] --> TgBot["Telegram Long Polling Daemon<br/>(src/telegram/poller.js)"]
    end

    subgraph SecurityGate ["Ingress Security Validation"]
        WebServer --> WebAuthCheck{"Argon2id Session Valid?"}
        WebAuthCheck -- "Yes" --> Authenticated["Authenticated Request<br/>Identity injected into context"]
        WebAuthCheck -- "No" --> DenyAccess["401 Unauthorized<br/>Session Login Required"]
        TgBot --> TgAuthCheck{"Chat ID in Whitelist?<br/>(telegram_config.chat_id)"}
        TgAuthCheck -- "Yes" --> Authenticated
        TgAuthCheck -- "No" --> DropTg["Drop & Log Unauthorized Message"]
    end

    subgraph PromptQueueLifecycle ["Unified Prompt Queue Engine (src/queue/inbox.js)"]
        Authenticated --> SubmitPrompt["Stage Inbound Prompt<br/>Payload + task context"]
        SubmitPrompt --> SQLiteInsert[("Insert SQLite prompt_queue<br/>• status: 'pending'<br/>• source: 'remote_ui' | 'telegram'<br/>• priority: 0, retry_count: 0")]
        SQLiteInsert --> FileMirror["Atomic Mirror Write<br/>• ~/.konoha/inbox/&lt;session_id&gt;.json<br/>• ~/.konoha/inbox/latest.json"]
        FileMirror --> ClientPickup["Coding Client Pickup / Polling<br/>(Antigravity · Cursor · Claude · OpenCode)"]
        ClientPickup --> MarkProcessing["Update Status: 'processing'"]
        MarkProcessing --> MarkCompleted["Update Status: 'completed' / 'failed'"]
        MarkCompleted --> RemoteDashboard["Real-Time Remote Access UI<br/>(apps/web/src/components/RemoteAccess.svelte)"]
    end

    linkStyle default stroke:#334155,stroke-width:2px;
    style IngressLayer fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style SecurityGate fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style PromptQueueLifecycle fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef clientNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef edgeNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef authNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef storageNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef denyNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

    class WebClient,TgUser,ClientPickup clientNode;
    class WebServer,TgBot edgeNode;
    class WebAuthCheck,TgAuthCheck authNode;
    class Authenticated,SubmitPrompt,SQLiteInsert,FileMirror,MarkProcessing,MarkCompleted,RemoteDashboard storageNode;
    class DenyAccess,DropTg denyNode;
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
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
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

    subgraph OfficePipeline ["Office Document Generation (src/workflow/tokubetsu-scribe/document_engine.js)"]
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
    style RequestRouting fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style OfficePipeline fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style AnimationPipeline fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style Deliverables fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef clientNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef officeNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef animNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef validNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef failNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

    class UserReq,TJ,SanninSynthesize clientNode;
    class DocCreate,SheetCreate,PresCreate,ZeroGPTCheck officeNode;
    class DiagCreate,AnimExport,PWCapture,LibWebPAnim,GifEncoder,WebPValidator,EncoderChoice animNode;
    class AIDetectorPass,WebPVerified,FinalHandoff validNode;
    class AutoCleanup,StaticFallback failNode;
```

---

## 15. Workflow 14: Akatsuki Security Controls & Dual-Mode Lab Lifecycle

```mermaid
---
title: Akatsuki Security Controls, Dual-Mode Engine & Lab Lifecycle Architecture
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TB
    Operator["Security Operator / CLI Ingress"] --> CLICommand{"Command Ingress"}

    subgraph ConfigStore ["Akatsuki State & Configuration (~/.konoha/akatsuki_config.json)"]
        CLICommand -- "konoha akatsuki mode [blue|red]" --> SetMode["Set Mode (Default: blue)<br/>• Blue = Defensive SAST / Guardian<br/>• Red = Offensive Pentest Sandbox"]
        CLICommand -- "konoha akatsuki env [docker|lxc]" --> SetEnv["Set Environment (Default: docker)<br/>• Docker = Linux/macOS/Windows<br/>• LXC = Linux/WSL bridge isolation"]
        CLICommand -- "konoha akatsuki status" --> StatusCheck["Report Mode, Env, Lab &amp; Tools"]
    end

    subgraph ModeSwitch ["Mode Gating & Authorization Firewall"]
        SetMode --> ModeBranch{"Active Mode?"}
        ModeBranch -- "Mode: BLUE (Defensive Default)" --> BlueOps["Blue-Team Defensive Operations<br/>• Direct Host SAST &amp; Secrets Audit<br/>• Dependency CVE Scans (pnpm/cargo/pip)<br/>• Skill Guardian Policy Scoring<br/>• Pre-Delivery Security Final Gate"]
        BlueOps --> BlueStopLab["Stop &amp; Remove akatsuki-lab Container<br/>(Fail-Closed Safety Invariant)"]

        ModeBranch -- "Mode: RED (Offensive Sandbox)" --> AuthGate{"Written RoE Authorization Check<br/>(Scope, Emergency Cutoff, Consent)"}
        AuthGate -- "Missing / Ambiguous" --> AuthDenied["BLOCKED: Decline Fail-Closed<br/>('Red-Team operations require authorization')"]
        AuthGate -- "Authorized &amp; Confirmed" --> SkillIdentityGate{"Caller Identity == @akatsuki?<br/>(skill_authorization.js)"}
        SkillIdentityGate -- "No / Anonymous" --> SkillDenied["BLOCKED: SKILL_AUTHORIZATION_DENIED<br/>Discovery, retrieval, dispatch &amp; delegation<br/>all fail closed"]
        SkillIdentityGate -- "Yes" --> AutoProvision["Automated Sandbox Provisioning<br/>(Idempotent Lab Setup Engine)"]
    end

    subgraph SandboxLifecycle ["Isolated Sandbox Execution (akatsuki-lab)"]
        AutoProvision --> EngineChoice{"Configured Engine?"}

        EngineChoice -- "Engine: DOCKER" --> DockerSetup["Docker Sandbox Engine<br/>• Isolated Internal Network (internal=true)<br/>• Unprivileged Non-Root (UID 1000 akatsuki)<br/>• Dropped Capabilities: --cap-drop=ALL<br/>• Memory limit: 2GB · CPU limit: 2 cores"]

        EngineChoice -- "Engine: LXC" --> LXCSetup["LXC System Container Engine<br/>• Isolated Bridge labbr0 (ipv4.nat=false)<br/>• Egress ACL lab-egress (Reject external traffic)<br/>• Unprivileged container (security.privileged=false)<br/>• Pinned Debian 12 Attacker Container"]

        DockerSetup --> SandboxReady["Sandbox Active: akatsuki-lab<br/>(Zero Host Network &amp; Zero Host FS Mounts)"]
        LXCSetup --> SandboxReady
    end

    subgraph ToolingGuard ["Approved Tool Execution & Persona Boundary"]
        SandboxReady --> LabDb["Lab-local SQLite · ~/.konoha/akatsuki-lab/lab.db<br/>lab_runs · lab_tool_invocations · kali_tools · red_skill_audit<br/>(main konoha.db never touched; LAB_DB_ISOLATION_VIOLATION on cross-path)"]
        LabDb --> ToolDispatch["Approved 10-Tool Sandbox Execution<br/>nmap · tshark · metasploit · zap · nuclei<br/>ffuf · sqlmap · testssl · trivy · curl_probe"]
        ToolDispatch --> EvidenceCollection["Structured Evidence Archival<br/>• Output XML / JSON / Logs to /tmp/akatsuki_*<br/>• Diagnostic Cleanup After Probe Execution"]
        EvidenceCollection --> GateHandoff["Handoff to Phase 8 Security Review Gate<br/>• Zero Critical &amp; High Findings<br/>• Remediation Patch Synthesis"]

        NonAkatsuki["Non-Akatsuki Agent Delegation<br/>(@genin, @anbu, @jonin, @chunin, @kage)"] --> PersonaCheck{"Offensive Skill Requested?"}
        PersonaCheck -- "Yes (classifySkill → red)" --> PersonaDenied["DENIED: SKILL_AUTHORIZATION_DENIED<br/>(red skills are @akatsuki-only, fail-closed)"]
    end

    linkStyle default stroke:#334155,stroke-width:2px;
    style ConfigStore fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style ModeSwitch fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style SandboxLifecycle fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;
    style ToolingGuard fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px,color:#334155;

    classDef cliNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef blueNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef redNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;
    classDef sandNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef passNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef failNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

    class Operator,CLICommand,StatusCheck cliNode;
    class BlueOps,BlueStopLab blueNode;
    class SetMode,SetEnv,AutoProvision,ToolDispatch,SkillIdentityGate redNode;
    class DockerSetup,LXCSetup,SandboxReady,EvidenceCollection,LabDb sandNode;
    class GateHandoff passNode;
    class AuthDenied,PersonaDenied,SkillDenied failNode;
```


---

## 16. Workflow 15: LangGraph.js Production State Graph & Error Edge Circuit Breaker

```mermaid
---
title: LangGraph.js Production State Graph, Per-Turn Budget Governor & Circuit Breaker Error Edge (v2.2.19)
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    StartGraph([__start__]) --> EntryRouter{"entryRouter<br/>(state.resumeNode)"}
    EntryRouter -- "resumeNode in RESUMABLE_NODES" --> ResumeTarget["resume at allowlisted node"]
    EntryRouter -- "unset / not allowlisted" --> ClassifyNode[node_classify]

    ClassifyNode -- "isFastTrack" --> CompleteNode[node_complete]
    ClassifyNode -- "direct_subagent intent" --> DispatchNode[node_dispatch]
    ClassifyNode -- "Standard Workflow" --> PlanNode[node_plan]

    PlanNode -- "hitlPending" --> Gate1End(["__end__ — Gate 1<br/>(pending_plan_approval)"])
    PlanNode -- "approved" --> BriefNode[node_brief]
    BriefNode --> TodoNode[node_todo]
    TodoNode --> DispatchNode

    DispatchNode -- "phase === 'done'" --> CompleteNode
    DispatchNode -- "default" --> ExecuteNode[node_execute]

    ExecuteNode -- "phase === 'document'" --> DispatchNode
    ExecuteNode -- "default" --> ReviewNode[node_review]

    ReviewNode -- "gateVerdict: pass" --> CompleteNode
    ReviewNode -- "gateVerdict: pending_signoff" --> Gate2End(["__end__ — Gate 2<br/>(pending_human_signoff)"])
    ReviewNode -- "gateVerdict: remediate / unknown" --> RemediateNode[node_remediate]

    RemediateNode --> DispatchNode

    ClassifyNode -. "Turn Budget Exceeded" .-> BudgetNode[node_budget_exceeded]
    PlanNode -. "Turn Budget Exceeded" .-> BudgetNode
    BriefNode -. "Turn Budget Exceeded" .-> BudgetNode
    TodoNode -. "Turn Budget Exceeded" .-> BudgetNode
    DispatchNode -. "Turn Budget Exceeded" .-> BudgetNode
    ExecuteNode -. "Turn Budget Exceeded" .-> BudgetNode
    ReviewNode -. "Turn Budget Exceeded" .-> BudgetNode
    RemediateNode -. "Turn Budget Exceeded" .-> BudgetNode

    ClassifyNode -. "Unhandled Error / Circuit Open" .-> ErrorNode[node_error]
    PlanNode -. "Unhandled Error / Circuit Open" .-> ErrorNode
    BriefNode -. "Unhandled Error / Circuit Open" .-> ErrorNode
    TodoNode -. "Unhandled Error / Circuit Open" .-> ErrorNode
    DispatchNode -. "Unhandled Error / Circuit Open" .-> ErrorNode
    ExecuteNode -. "Unhandled Error / Circuit Open" .-> ErrorNode
    ReviewNode -. "Unhandled Error / Circuit Open" .-> ErrorNode
    RemediateNode -. "Unhandled Error / Circuit Open" .-> ErrorNode

    CompleteNode --> EndGraph([__end__])
    BudgetNode --> EndGraph
    ErrorNode --> EndGraph

    linkStyle default stroke:#334155,stroke-width:2px;
    classDef startEnd fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef coreNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef warnNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef errNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;
    classDef successNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;

    class StartGraph,EndGraph,Gate1End,Gate2End startEnd;
    class EntryRouter,ClassifyNode,PlanNode,BriefNode,TodoNode,DispatchNode,ExecuteNode coreNode;
    class BudgetNode,ReviewNode,ResumeTarget warnNode;
    class ErrorNode,RemediateNode errNode;
    class CompleteNode successNode;
```


---

## 17. Workflow 16: Turn-Scoped Budget Execution & Resume Loop Protocol

```mermaid
---
title: LangGraph.js Turn-Scoped Budget Execution & Resume Loop Protocol (v2.2.19)
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    StartTurn(["__start__"]) --> EntryRouter{"entryRouter<br/>(inspects state.resumeNode)"}
    
    EntryRouter -- "resumeNode empty / unset" --> ClassifyNode["node_classify"]
    EntryRouter -- "resumeNode = node_plan" --> PlanNode["node_plan (Gate 1 HITL)"]
    EntryRouter -- "resumeNode = node_brief" --> BriefNode["node_brief"]
    EntryRouter -- "resumeNode = node_todo" --> TodoNode["node_todo"]
    EntryRouter -- "resumeNode = node_dispatch" --> DispatchNode["node_dispatch"]
    EntryRouter -- "resumeNode = node_execute" --> ExecuteNode["node_execute"]
    EntryRouter -- "resumeNode = node_review" --> ReviewNode["node_review (Gate 2 Sign-off)"]
    EntryRouter -- "resumeNode = node_remediate" --> RemediateNode["node_remediate"]
    EntryRouter -- "resumeNode = node_complete" --> CompleteNode["node_complete"]

    ClassifyNode --> PlanNode
    ClassifyNode -- "direct_subagent intent" --> DispatchNode
    ClassifyNode -- "isFastTrack" --> CompleteNode
    PlanNode --> BriefNode
    BriefNode --> TodoNode
    TodoNode --> DispatchNode
    DispatchNode --> ExecuteNode
    DispatchNode -- "phase === 'done'" --> CompleteNode
    ExecuteNode --> ReviewNode
    ExecuteNode -- "phase === 'document'" --> DispatchNode
    ReviewNode --> CompleteNode
    ReviewNode -- "gateVerdict: remediate / unknown" --> RemediateNode
    ReviewNode -- "gateVerdict: pending_signoff" --> Gate2End(["__end__ — Gate 2<br/>(pending_human_signoff)"])
    RemediateNode --> DispatchNode

    ClassifyNode -. "Turn Budget Exceeded" .-> BudgetHalt["node_budget_exceeded<br/>(status: paused_budget_exceeded<br/>persists resumeNode: successor<br/>workflow_complete: false)"]
    PlanNode -. "Turn Budget Exceeded" .-> BudgetHalt
    BriefNode -. "Turn Budget Exceeded" .-> BudgetHalt
    TodoNode -. "Turn Budget Exceeded" .-> BudgetHalt
    DispatchNode -. "Turn Budget Exceeded" .-> BudgetHalt
    ExecuteNode -. "Turn Budget Exceeded" .-> BudgetHalt
    ReviewNode -. "Turn Budget Exceeded" .-> BudgetHalt
    RemediateNode -. "Turn Budget Exceeded" .-> BudgetHalt

    ExecuteNode -. "Node Exception / Breaker Open" .-> ErrorHalt["node_error<br/>(status: error<br/>persists resumeNode: failed node<br/>retryable: true)"]
    ReviewNode -. "Circuit Open" .-> ErrorHalt
    RemediateNode -. "Circuit Open" .-> ErrorHalt

    BudgetHalt --> EndTurn(["__end__ (Turn Pauses)"])
    ErrorHalt --> EndTurn
    CompleteNode --> EndTurn
    Gate2End --> EndTurn

    EndTurn -. "Subsequent Turn Invocation<br/>turnTokensUsed: 0 · budgetExceeded: false<br/>persisted ceiling preserved" .-> StartTurn

    classDef startNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef routerNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef activeNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef haltNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef errorNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

    class StartTurn,EndTurn,Gate2End startNode;
    class EntryRouter routerNode;
    class ClassifyNode,PlanNode,BriefNode,TodoNode,DispatchNode,ExecuteNode,ReviewNode,RemediateNode,CompleteNode activeNode;
    class BudgetHalt haltNode;
    class ErrorHalt errorNode;
```

### Architectural Guarantees & Operational Lifecycle

1. **Turn vs Workflow Scoping**: Reaching a per-turn token ceiling (8k, 16k, 32k, or 64k) suspends the **current turn** rather than terminating the workflow. The node cursor is cleanly persisted in SQLite checkpoint storage via `resumeNode`.
2. **Deterministic Resumption Routing**: When the caller resumes via `sannin`, `entryRouter` evaluates `state.resumeNode` against the allowlist `RESUMABLE_NODES` and dispatches directly to the resume point. Earlier nodes are skipped, preserving monotonic progress.
3. **No Caller Overhead**: Resuming turns do not require re-supplying `token_budget` or prior-turn arguments; persisted ceilings survive across turn boundaries automatically.
4. **Single-Owner Token Metering**: Every node update passes through `finalizeNodeResult` in `src/mcp/langgraph/budget.js`, which computes `tokensUsed`, `turnTokensUsed`, `budgetExceeded`, and `resumeNode` in one place.
5. **Per-Thread Circuit Breaker**: Error edges are guarded by thread-scoped breakers (`workflow:${threadId}`). When `node_remediate` trips the breaker it sets `gateVerdict = 'circuit_open'`, and `reviewRouter`/`remediateRouter` route to `node_error`. The 3-consecutive-failure trip count and the wiring itself live in the guard/breaker modules; only the routing consequence is asserted here.
6. **HITL resume is a self-resume**: a Gate pause is produced by `finalizeNodeResult(..., { selfResume: true, selfNode })`, so `resumeNode` names the same node that paused. `node_plan` pauses Gate 1; `node_review` pauses Gate 2. Budget exhaustion instead records the **successor** node.
7. **Early-exit ordering**: `node_execute` loops back to `node_dispatch` (not to itself) when `phase === 'document'`, and `node_remediate` always returns to `node_dispatch`. The graph never loops `node_execute → node_execute` or `node_remediate → node_review`.

---

## 18. Workflow 17: Text-to-3D Generation Pipeline (Yamanaka Graph)

```mermaid
---
title: Yamanaka Text-to-3D Generation Pipeline & Agentic Blender Refinement (v2.2.19)
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    PromptIn(["Text Prompt &amp; Style Directives<br/>(POST /api/v1/3d/generate)"]) --> InitNode["Stage 1: Prompt Intake<br/>• init (nodeInit)<br/>• Parameter normalization &amp; budget clamping"]
    
    InitNode --> SynthNode["DSL Synthesis<br/>• synthesize_dsl (nodeSynthesizeDsl)<br/>• LLM scene spec &amp; archetype selection"]
    
    SynthNode --> PreValNode{"Pre-Validation<br/>• validate_pre (nodeValidatePre)<br/>• Schema check &amp; primitive budget"}
    
    PreValNode -- "Schema Valid" --> BaseMeshNode["Stage 2: Manifold Geometry<br/>• build_base (nodeBuildBaseMesh)<br/>• Three.js + Manifold-3D watertight CSG mesh"]
    
    PreValNode -- "Schema Invalid" --> RepairPre["Repair Stage<br/>• repair (nodeRepair)<br/>• Autonomous spec healing"]
    RepairPre --> BaseMeshNode
    
    BaseMeshNode --> PbrNode["Stage 3: PBR Shading<br/>• MeshPhysicalMaterial layer setup<br/>• Micro-chamfer bevels &amp; physical roughness/metalness"]
    
    PbrNode --> BlenderNode["Stage 4: Blender Refinement<br/>• refine_blender (nodeRefineBlender)<br/>• dcc-mcp-blender 6-step agentic refinement<br/>(Import GLB → Bevel/Normals → Smart UV → PBR BSDF → Studio Light → Export)"]
    
    BlenderNode --> PostValNode{"Stage 4 Gate: Post-Validation<br/>• validate_post (nodeValidatePost)<br/>• 11-row scoreSpec validation gate"}
    
    PostValNode -- "scoreSpec Passed (≥98% confidence)" --> PromoteNode["Stage 5: Asset Export<br/>• promote (nodePromoteAsset)<br/>• Watertight GLB export &amp; DB telemetry"]
    
    PostValNode -- "scoreSpec Defect" --> RepairPost["Repair Loop<br/>• repair_post (nodeRepairFromPostGate)<br/>• marks a post-gate repair"]
    RepairPost --> RepairRepair["repair (nodeRepair)<br/>• Topology &amp; material adjustment<br/>• charged to postRepairAttempts"]
    RepairRepair -- "post-gate repair" --> PostValNode
    
    PromoteNode --> EndAsset(["Production 3D Asset<br/>(~/.konoha/3d-output/ &amp; SSE Stream Complete)"])

    linkStyle default stroke:#334155,stroke-width:2px;
    classDef startEnd fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef intakeNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef geomNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef refineNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef gateNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef errNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

    class PromptIn,EndAsset startEnd;
    class InitNode,SynthNode intakeNode;
    class BaseMeshNode,PbrNode geomNode;
    class BlenderNode refineNode;
    class PreValNode,PostValNode,PromoteNode gateNode;
    class RepairPre,RepairPost errNode;
```

### Architectural Guarantees & Operational Lifecycle

1. **14-Node Pipeline Sequencing**: Text-to-3D executes the full LangGraph in `src/workflow/yamanaka/graph.js` — `init` → `refine_request` → (`settle_refine_failure`) → `chunin_search` → `object_brief` → `synthesize_dsl` → `validate_pre` → `build_base` → `refine_blender` → `inspect` → (`fix` back to `build_base`) → `validate_post` → `promote`, with `repair` looping back to `build_base` on a pre-gate scoreSpec defect and back to `validate_post` on a post-gate defect (the post-gate pass is routed through `repair_post` and charged to its own `postRepairAttempts` budget). `settle_refine_failure` and `fix` are conditional branches, not optional extras.
2. **Watertight Manifold Invariant**: Geometry generated by Manifold-3D is mathematically guaranteed watertight (zero self-intersections, watertight non-manifold edge count = 0) prior to Blender hand-off.
3. **Agentic 6-Step Blender Processing**: `dcc-mcp-blender` applies deterministic bevel modifiers, smart UV unwrapping, principled PBR BSDF material networks, studio three-point lighting, and export verification.
4. **11-Row scoreSpec Validation Gate**: `validate_post` enforces Production geometric and shading tolerances before promoting staging assets to production (`~/.konoha/3d-output/`).
5. **Real-Time Telemetry & Progress Streaming**: SSE endpoint `GET /api/v1/3d/generate/:jobId/stream` emits stage transitions, node timers, and GPU memory utilization to the Web UI in real time.

---

## 19. Workflow 18: Image-to-3D Upload, Relief Mesh & Blender Refinement Pipeline

```mermaid
---
title: Yamanaka Image-to-3D Upload, Relief Mesh & Blender Refinement Pipeline (v2.2.19)
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#f0fdf4'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TD
    ImgUpload(["Image Upload Ingress<br/>POST /api/v1/3d/upload-image<br/>(12 MB cap · magic-byte sniff: PNG/JPEG/WEBP)"]) --> UploadGate{"Image Ingress Validation<br/>Magic byte &amp; path traversal check"}
    
    UploadGate -- "Valid Image" --> StageInput["Stage 1: Image Intake<br/>• Store to ~/.konoha/3d-output/inputs/<br/>• POST /api/v1/3d/generate (source_mode: image_to_3d)<br/>• init (nodeInit) &amp; SSE stream initialization"]
    
    UploadGate -- "Invalid / >12 MB" --> UploadReject["HTTP 400 / 415 Rejection<br/>(unsupported_image_format)"]
    
    StageInput --> DslNode["Vision / Relief Synthesis<br/>• synthesize_dsl (nodeSynthesizeDsl)<br/>• Vision DSL synthesis or deterministic image-relief fallback"]
    
    DslNode --> BaseGeom["Stage 2: Manifold Geometry<br/>• build_base (nodeBuildBaseMesh)<br/>• buildImageReliefScene + Manifold-3D watertight relief"]
    
    BaseGeom --> PbrShade["Stage 3: PBR Shading<br/>• Diffuse texture mapping &amp; normal projection<br/>• MeshPhysicalMaterial dielectric / metallic tuning"]
    
    PbrShade --> BlenderRefine["Stage 4: Blender Refinement<br/>• refine_blender (nodeRefineBlender)<br/>• dcc-mcp-blender agentic processing<br/>(Smart UV unwrapping, normal smoothing, studio lighting)"]
    
    BlenderRefine --> PostGate{"Post-Validation Gate<br/>• validate_post (nodeValidatePost)<br/>• 11-row scoreSpec validation check"}
    
    PostGate -- "Passed (scoreSpec clean)" --> PromoteStage["Stage 5: GLB Export &amp; Promotion<br/>• promote (nodePromoteAsset)<br/>• GLB file write &amp; token telemetry recording"]
    
    PostGate -- "Defect Detected" --> RepairLoop["Autonomous Repair<br/>• repair_post (nodeRepairFromPostGate)<br/>• Mesh re-triangulation &amp; UV re-map"]
    RepairLoop --> PostGate
    
    PromoteStage --> FinalOutput(["Delivery &amp; Client Telemetry<br/>• Preview PNG + Binary GLB download<br/>• SSE completed event &amp; Recent Assets gallery"])

    linkStyle default stroke:#334155,stroke-width:2px;
    classDef startEnd fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef intakeNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef geomNode fill:#eff6ff,stroke:#3b82f6,color:#334155,stroke-width:2px;
    classDef refineNode fill:#fff7ed,stroke:#f97316,color:#334155,stroke-width:2px;
    classDef gateNode fill:#f0fdf4,stroke:#10b981,color:#334155,stroke-width:2px;
    classDef errNode fill:#fef2f2,stroke:#ef4444,color:#334155,stroke-width:2px;

    class ImgUpload,FinalOutput startEnd;
    class StageInput,DslNode intakeNode;
    class BaseGeom,PbrShade geomNode;
    class BlenderRefine refineNode;
    class UploadGate,PostGate,PromoteStage gateNode;
    class UploadReject,RepairLoop errNode;
```

### Pipeline Stages & Operational Guarantees

1. **Ingress Security & Sniffing**: `POST /api/v1/3d/upload-image` validates true file types via magic bytes (`PNG`, `JPEG`, `WEBP`) with strict 12 MB payload cap, returning HTTP 415 on unsupported formats and blocking path traversal attacks.
2. **Deterministic Relief Fallback**: When external vision APIs are unconfigured or circuit-broken, `synthesize_dsl` seamlessly activates `buildImageReliefScene` to generate clean bas-relief geometry from heightmap luminosity without hallucinated rigs.
3. **PBR Shading Parity**: Image textures map directly across generated geometry with physical dielectric roughness and metallic controls, adhering to the Zero-AI-Slop no-flat-shading rule.
4. **Blender LTS Agentic Refinement**: The 6-step `dcc-mcp-blender` headless worker pipeline refines edge bevels, projects UV coordinates, and configures studio rendering environments.
5. **Asset Registry & Downloader**: Exported `.glb` binaries and `.png` previews are indexed under `~/.konoha/3d-output/` with instant browser download endpoints (`/api/v1/3d/assets/:filename`).
