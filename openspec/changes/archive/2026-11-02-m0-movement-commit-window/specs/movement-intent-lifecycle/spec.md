# Spec Delta

## Purpose

Defines the tick-level lifecycle of movement intents: when pending intents are reset, when they are resolved, and which module ordering guarantees apply so that every phase can register movement in the same tick it runs.

## ADDED Requirements

### Requirement: Tick-start intent reset

The system MUST discard pending movement intents before any phase module runs in a tick, so no intent registered in a previous tick can be executed in the current tick.

#### Scenario: Stale intent is discarded

- **WHEN** a unit registered a movement intent in the previous tick and that intent was not resolved
- **THEN** at the start of the next tick the pending intent MUST be removed before perception, planning, agents, or commit modules execute

#### Scenario: Current-tick intents survive until resolution

- **WHEN** a module registers a movement intent after the tick-start reset and before the movement resolution step
- **THEN** that intent MUST remain available for resolution in the same tick

### Requirement: Late commit intents resolve in the same tick

Movement intents registered by any commit-phase module MUST be resolved in the same tick after the last commit-phase movement producer has run, regardless of whether that module is registered before or after the action broker.

#### Scenario: Team controller moves after the broker

- **WHEN** a team controller runs in the commit phase after the action broker and requests movement for a squad member
- **THEN** the squad member's position MUST be updated in the same tick unless the move is blocked

#### Scenario: Power Creep moves after the broker

- **WHEN** a Power Creep runs in the commit phase after the action broker and requests movement
- **THEN** the Power Creep's position MUST be updated in the same tick unless the move is blocked

#### Scenario: End hook sits after movement producers and before visuals

- **WHEN** a production entry mounts modules in the commit phase
- **THEN** the movement resolution hook MUST be registered after every commit-phase movement producer and before commit-phase visual consumers

### Requirement: Resolution precedes traffic sampling

The system MUST resolve movement before congestion sampling, and both steps MUST occur after all commit-phase movement producers have run and before visual consumers read positions.

#### Scenario: Congestion uses post-move positions

- **WHEN** a unit holds a movement intent but does not change position because it is blocked
- **THEN** congestion sampling MUST compare the post-resolution position with the previous tick and record the block

#### Scenario: Successful move clears congestion

- **WHEN** a unit with a recorded congestion entry moves during resolution
- **THEN** congestion sampling MUST observe the position change and clear or reduce the block record

### Requirement: Window hooks are safety-critical

The tick-start reset hook and the end-of-commit resolution hook MUST run at the safety-critical priority band so CPU budget pressure does not skip them while CPU remains available.

#### Scenario: Low bucket does not skip the window

- **WHEN** the CPU bucket is below the low-bucket threshold and remaining CPU is above zero
- **THEN** both window hooks MUST still execute

#### Scenario: Hook failure is isolated

- **WHEN** the movement window hook throws an error
- **THEN** the error MUST be reported through the existing module error boundary and MUST NOT propagate to later modules or the top-level loop

### Requirement: Work-tile lock semantics preserved

The movement window MUST preserve the existing work-tile predicate semantics, including the task and worksite lookup used to keep harvesters pinned to their assigned worksite.

#### Scenario: Pinned harvester is not displaced

- **WHEN** a harvester holds a harvest task and stands on its assigned worksite
- **THEN** traffic resolution MUST treat it as being on its work tile and MUST NOT push it off that tile

#### Scenario: Unit without a worksite is displaceable

- **WHEN** a unit has no matching harvest worksite
- **THEN** traffic resolution MUST treat it as displaceable

### Requirement: No legacy executor fallback

A unit without a task pointer MUST NOT be driven through a legacy executor as a side effect of the movement window; it MUST be reported as idle and skipped for movement planning.

#### Scenario: Idle unit produces no intent

- **WHEN** a live unit has no task pointer
- **THEN** the agent phase MUST NOT invoke a legacy executor for it and MUST NOT register a movement intent for it

### Requirement: Variant coverage

Every production entry that mounts the agent and commit pipeline MUST use the same tick-start reset and end-of-commit resolution ordering. The stronghold challenge entry MAY keep its existing equivalent split window.

#### Scenario: Main-like entries share the window

- **WHEN** the main, local, or season entry mounts its modules
- **THEN** the tick-start reset MUST be registered before all other modules and the resolution hook MUST be registered after all commit-phase movement producers and before visual consumers

#### Scenario: Stronghold keeps its split window

- **WHEN** the stronghold entry mounts its modules
- **THEN** it MUST reset before team actions and resolve after team actions, preserving its existing behavior
