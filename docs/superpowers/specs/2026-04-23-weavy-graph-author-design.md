# Weavy Graph Author Design

Date: 2026-04-23
Status: Draft for review
Project: `~/workflow`

## Summary

Build a chat/API system that turns plain-English media workflow requests into validated Weavy graphs with initial prompt scaffolding, asks only a few high-value questions when needed, and returns both the graph and a clear explanation.

The product is not "an AI that invents arbitrary graphs." It is a graph synthesis engine with an LLM-driven planning layer and deterministic catalog-backed validation.

## Product Goal

Primary user:
- Non-technical creators who describe an app or workflow and want a usable Weavy graph with minimal decisions.

Primary outcome:
- A user describes a media workflow in plain English, answers 0-2 focused questions, and receives a valid draft graph plus a clear explanation of what was built and why.

Initial domain:
- Media-first workflows, especially:
  - image generation from prompt
  - image edit or remix from reference
  - compare or branch prompt variants
  - prompt compose -> generate -> refine flows
  - simple image/video transformation chains

## Non-Goals for V1

V1 is not:
- a universal graph generator for the full Weavy catalog
- a fully autonomous general-purpose agent
- a raw JSON generator with weak guarantees
- a no-question experience at all costs
- a system that expects users to finish all prompt work manually after graph creation

## Product Definition

V1 is a:
- media-workflow graph author
- prompt scaffold generator
- validator-enforced graph compiler
- explanation-rich chat/API backend

The long-term vision can be a ChatGPT-style embedded integration that shows the graph inline and deep-links to the editor, but the first product should be built as a controllable backend with a clean API and portable response contract.

## Core Principles

1. The model can interpret intent, propose structure, and generate prompt scaffolding.
2. The node catalog and graph rules remain the source of truth.
3. No graph is returned unless it passes deterministic validation.
4. Questions are used to improve trust and correctness, not to compensate for weak planning.
5. Prompt-bearing nodes are first-class output targets, not empty placeholders by default.

## Architecture

The system should be built around one explicit pipeline:

`conversation -> intent -> plan -> prompt plan -> graph candidate -> validate/repair -> final graph + explanation`

### Layer 1: Conversation Layer

Responsibilities:
- accept plain-English requests
- collect assets, prompt fragments, brand/product context
- ask clarifying questions
- present explanation and next-step guidance

Non-responsibilities:
- graph correctness
- final authority over node structure

### Layer 2: Intent Interpreter

Transforms user input into structured request fields.

Example `RequestIR` fields:
- `goal`
- `workflowFamily`
- `targetOutput`
- `assets`
- `brandContext`
- `explicitPrompts`
- `constraints`
- `missingInfo`
- `assumptions`
- `confidence`

This is where the model does interpretation work.

### Layer 3: Plan Layer

Chooses graph strategy and question strategy.

Example `PlanIR` fields:
- `graphFamily`
- `graphStrategy`
- `promptStrategy`
- `requiredQuestions`
- `candidatePatterns`
- `riskFlags`
- `assumptions`

The planner may reuse known workflow patterns, but it is also allowed to propose new node combinations as long as they are assembled from the supported catalog and can pass validation.

### Layer 4: Prompt Planning Layer

Prompt planning should be a sibling of graph planning, not a child of it.

Example `PromptIR` fields:
- `nodePromptTargets`
- `promptPurposeByNode`
- `generatedPromptText`
- `editableFields`
- `sharedVariables`
- `promptDependencies`
- `promptConfidence`

Why this is separate:
- prompt structure often determines whether the workflow is useful
- graph choice may depend on prompt strategy
- reusable workflows need coherent prompt systems, not just valid wiring

### Layer 5: Graph Synthesis Layer

Compiles a graph candidate from:
- allowed node catalog
- node parameter schemas
- port compatibility rules
- graph-level constraints
- app-mode or output rules
- prompt plan outputs

This layer should be mostly deterministic.

### Layer 6: Validation and Repair Layer

Owns graph correctness.

Outputs one of:
- `valid`
- `repairable`
- `question-required`
- `unsupported`

### Layer 7: Explanation Layer

Builds the user-facing explanation from the final plan and validated graph, not from freeform model improvisation.

The explanation should cover:
- what graph was built
- why that structure was chosen
- which prompts were generated and why
- assumptions made
- what the user can tweak next

## Runtime Flow

The runtime should be staged, not single-shot:

1. Parse request.
2. Run a deterministic gap check.
3. Generate a short internal plan.
4. Decide whether a question is required.
5. Build candidate prompt plan.
6. Compile candidate graph.
7. Validate.
8. Repair if safe.
9. Ask if a semantic decision remains unresolved.
10. Return final graph plus explanation.

Target UX rhythm:
- brief understanding
- maybe 0-2 focused questions
- graph
- explanation

## Questioning Model

Questions should exist in two modes.

### Pre-Graph Questions

Ask only when a missing fact materially changes graph structure, required nodes, or major params.

Examples:
- image generation vs image edit
- single output vs compare variants
- missing reference asset for a clearly reference-driven workflow

### In-Graph Confirmation Questions

Ask when the system has a likely plan but one structural choice is risky.

Examples:
- single-pass generation flow vs compare-two-prompts flow
- prompt node directly into media node vs prompt enhancer chain

Rule:
- ask only when the answer changes topology, critical prompt strategy, or major node behavior
- do not ask for details that are cheaper for the user to edit afterward

## Prompt Generation Model

Because Weavy workflows are heavily input- and prompt-driven, prompt generation is a first-class output, not optional polish.

If the user intent is sufficient, the system should generate initial prompt values for prompt-bearing nodes. It should not return empty prompt nodes by default unless the workflow explicitly calls for user-authored prompt slots.

### Prompt Handling Modes

1. Direct prompt derivation
   - If the user gives a clear creative brief or literal prompt, convert it into node prompts directly.

2. Structured prompt scaffolding
   - If the user provides a business or creative goal but not final prompts, generate reusable prompt structure.
   - Example parts:
     - base product prompt
     - scene variation prompt
     - style or campaign prompt
     - negative or constraint prompt

3. Prompt-slot questions
   - Ask only when one missing variable would strongly improve output quality.
   - Example missing factors:
     - target audience
     - brand tone
     - visual style
     - ad objective

Rule:
- if the system can generate a strong first prompt from intent, it should
- if one missing factor would materially improve prompt quality, ask for it

## Weavy-Specific Constraints

The architecture should align with the current Weavy editor model documented in the official help center.

Relevant references:
- Understanding Nodes: https://help.weavy.ai/en/articles/12292386-understanding-nodes
- Prompt Variables: https://help.weavy.ai/en/articles/14047674-prompt-variables
- Text Tools: https://help.weavy.ai/en/articles/12268282-text-tools

Design implications:
- nodes are typed by inputs and outputs, so graph compilation must respect content-type compatibility
- prompt structures should map to actual prompt-oriented nodes, not only generic text params
- prompt variables are a native concept, so the planner should support reusable prompt decomposition
- prompt enhancement is a native pattern and should be available as an intentional planning choice
- image/video describer nodes should be considered when a user supplies reference media and the workflow benefits from extracting prompt structure from assets

Supported prompt planning patterns for v1 should include:
- `Prompt Node -> media node`
- `Prompt Node -> Prompt Enhancer -> media node`
- `Text/variable nodes -> Prompt Node -> media node`
- `Prompt Concatenator -> Prompt Node or downstream text consumer`
- `Image Describer/Video Describer -> prompt refinement -> media node`

## Validation and Repair

Validation must be deterministic and catalog-backed.

Minimum checks:
- node type exists
- required params are present
- param values satisfy schema
- edge connections are type-compatible
- required inputs are satisfied
- graph-level constraints are satisfied
- output bindings are valid
- app-mode constraints are satisfied

### Repair Classes

1. Mechanical repair
   - safe fixes that do not change intent
   - examples: default param fill, obvious port selection, missing output binding

2. Pattern repair
   - replace an invalid local structure with the nearest valid one when semantics are preserved

3. Question instead of repair
   - if a fix would alter meaning or output quality in a non-trivial way, ask the user

Rule:
- auto-repair syntax and mechanics
- ask on semantics

## Success Metrics

Track:
- first-pass valid rate
- repaired-valid rate
- question-required rate
- unsupported-request rate
- prompt-filled-node rate
- user-edit-after-generation rate

The product should be optimized for valid, useful first drafts rather than maximum freeform novelty.

## Example Product Behavior

Example request:
- "Create an ad generator with Grok for my bag product. I want to import different scenes and generate new product scenes quickly."

Expected system behavior:
- infer a media workflow family
- identify that prompt quality matters as much as graph shape
- generate an initial prompt system for product identity and scene variation
- decide whether one or two questions are needed, for example brand tone or target audience
- produce a valid graph using supported prompt and media nodes
- explain which prompts are base prompts, which are variables, and which parts are intended to stay editable

## Recommended Implementation Direction

The current repository already has relevant building blocks in:
- `src/v2/compiler`
- `src/v2/registry`
- `src/v2/validate`
- `src/v2/retrieval`
- `src/v2/materializer`

The recommended cleanup is not a new stack. It is stronger separation around IRs and ownership:
- conversation owns interaction
- planner owns intent and strategy
- prompt planner owns prompt scaffolding
- compiler owns graph synthesis
- validator owns correctness
- explanation layer owns user-facing translation

## Open Decisions for the Next Phase

The implementation plan should settle:
- the exact IR schemas
- the catalog representation for prompt-bearing nodes and variable-capable nodes
- how pattern retrieval and freeform synthesis interact
- whether repair is a single pass or iterative
- the response contract for future ChatGPT-style embedding

## Final Recommendation

Treat v1 as:

`a graph author + prompt scaffold generator for media-first Weavy workflows`

Do not optimize first for universal coverage.
Optimize first for:
- trustworthy graph synthesis
- good questions
- useful prompt scaffolding
- deterministic validation
- explanation quality
