# Svelte Audit Status

Last updated: 2026-05-31.

## Remaining Items

- Direct Transcript Writes During Send
- Send Result Is Treated As Success
- Durable Reattach Stop Handle Drift
- First-Message Greeting Swipes Mutate Chat State
- Auto-Suggestions Race The Selected Chat
- Chat Asset Picker Mutates Character Assets
- Pending Inlay Preview Can Crash
- Screenshot History Load Is Not Stabilized
- Author Note Binding Bypasses Commands
- Chat Submit Uses Projected Objects As Mutable Drafts
- Suggestion Persistence Is Not Server-Owned
- Hydration In-Flight Calls Resolve Too Early
- Hydration Can Apply Stale Responses After Reset
- Single Chat Export Keeps A Pre-Hydration Alias
- Playground Character Creation Pushes Into Projection
- Debounced Character Profile Bridge Is Global
- Debounced Chat/Folder Bridge Is Global
- Plugin Argument Updates Are Guarded But Index-Based
- Asset Preview Caches Are Indexed, Not Identified
- Mobile Hotkey Settings Can Render Blank
- Chat Row Actions Bubble To Chat Selection
- Plugin Row Controls Toggle Expansion
- Expanded Plugin State Uses List Indexes
- Streaming Auto-Toggle Predicate Is Asymmetric
- WaveSpeed Reference Reset Appears Inverted
- Chat Rows Are Manually Mounted And Not Updated
- Chat Hash Omits Render-Affecting Props
- Custom HTML Renderer Drops Functional Attributes
- Message Action Layout Reads `window.innerWidth` In Markup
- TextAreaInput Highlight Mode Can Throw On Selection State
- TextAreaInput Highlight Mode Misses Input Side Effects
- TextAreaInput Optimized Mode Delays Bound Value
- TextAreaResizable Does Not React To Parent Value Changes
- Popup Position Is Not Reactive To Resize
- Portal Effects Can Remount On Unrelated Changes
- LazyPortal Observes The Target Instead Of A Sentinel
- Hypa V3 Memo Search Assumes Collapsed Refs Exist
- Realm Detail Popup Closes On Inner Clicks
- Realm Upload Validates Stale Creator Notes
- RealmFrame Ping Loop Has No Cancellation
- Plugin Alert Continue Action Is Hidden In Details
- NewGUI Button Has Missing Branches And Events

## Completed Items

- Chat Format Settings Lack Client Command Mapping
- One-Item Drop Lists Can Corrupt The List
- Realm Upload Mode Buttons Toggle The Wrong State
- Plugin Select Options Render Literal Text
