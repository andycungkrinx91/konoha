# QA Automation Report: apps/web (Routes & Detector)

- **Date**: 2026-10-06
- **Target URL**: http://127.0.0.1:4173/ and http://127.0.0.1:4173/detector
- **Assigned Agent**: Anbu
- **Run ID**: `qa-1791260811581-fcd975`
- **Overall Status**: GREEN (2 passed, 0 failed)

## Executive Summary

- **Total Flows Executed**: 2
- **Passed**: 2
- **Failed**: 0
- **AI Slop Findings**: 0

## Findings

None found in `apps/web routes / and /detector`, 12 actions.
Both routes redirect and mount cleanly with 0 console errors and 0 runtime exceptions.

### Executed Flow Specifications

1. **Routes Load & Redirect Flow**:
   - Flow Spec: [`tests/e2e/flows/routes_load.json`](file:///home/andycungkrinx/experiment/portofolio/data/konoha/tests/e2e/flows/routes_load.json)
   - Test Spec: [`tests/e2e/routes_load.spec.js`](file:///home/andycungkrinx/experiment/portofolio/data/konoha/tests/e2e/routes_load.spec.js)
   - Status: GREEN

2. **Document AI Detector Flow**:
   - Flow Spec: [`tests/e2e/flows/detector_flow.json`](file:///home/andycungkrinx/experiment/portofolio/data/konoha/tests/e2e/flows/detector_flow.json)
   - Test Spec: [`tests/e2e/detector_flow.spec.js`](file:///home/andycungkrinx/experiment/portofolio/data/konoha/tests/e2e/detector_flow.spec.js)
   - Status: GREEN
