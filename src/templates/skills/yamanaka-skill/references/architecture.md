# Yamanaka 3D Architecture & StateGraph Specification

## Overview
The Yamanaka subsystem is orchestrated by LangGraph.js (`@langchain/langgraph`) using an explicit StateGraph (`src/workflow/yamanaka/graph.js`) backed by SQLite `STRICT` persistence and `KonohaCheckpointSaver`.

## State Schema (`Yamanaka3DStateAnnotation`)
- `jobId`: Unique job identifier (`job_<timestamp>_<hex>`).
- `nonce`: Cryptographic nonce for staging isolation.
- `sourceMode`: `text_to_3d` | `image_to_3d` | `dsl_direct`.
- `status`: Multi-stage lifecycle (`synthesizing_spec`, `parsing_dsl`, `validating_base_mesh`, `refining_blender`, `validating_final_asset`, `promoting_asset`, `completed`, `failed`).
- `profile`: `enterprise_pbr` | `realistic` | `premium_stylized` | `draft`.
- `qualityPreset`: `draft` | `standard` | `high` | `ultra`.
- `requestedComputeMode`: `auto` | `gpu` | `cpu`.
- `effectiveComputeMode`: `gpu` | `cpu` (with seamless automatic CPU fallback if physical GPU absent).
- `baseGlbPath`, `liveGlbPath`, `refinedGlbPath`, `previewPngPath`.
- `scoreSpecPre`, `scoreSpecPost`: Structured 11-row validation scores.
- `repairAttempts`: Bounded by `MAX_YAMANAKA_REPAIR_ATTEMPTS = 3`.
- `liveAgentSteps`: Telemetry stream of 6-step agentic actions.
- `inputTokens`, `outputTokens`, `totalTokens`, `estCostUsd`: Deterministic token/cost accounting.

## Circuit Breakers
1. `yamanaka-llm-synthesis`: 3 failures in 60s window trips circuit to OPEN.
2. `yamanaka-dcc-mcp-blender`: 3 failures in 60s window trips circuit to OPEN and falls back to deterministic Three.js pipeline.
3. `MAX_YAMANAKA_REPAIR_ATTEMPTS`: Repair loop is capped at 3 iterations to prevent runaway token spend.
