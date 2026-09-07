# Souls and capabilities in Desktop

Selecting a soul opens its details. Launch and Schedule are explicit actions;
Quick Open and Enter inspect instead of launching. The existing local Files
browser remains available. It is separate from provider knowledge inspection.

The inspector reads the kernel's `oats inspect --json` answer on selection,
Refresh, or after an explicit mutation. The roster's eight-second poll never
rescans capabilities or replaces an editor. Workspace changes invalidate old
responses. Same-named souls are addressed by name plus agents root; instances
are addressed by their exact home.

The Capabilities button inspects workspace defaults, with a member-scope
selector where a workspace contains several roots. Installed version, source
and health are separate from effective activation, provenance and settings.
Enable, explicit disable and return to inheritance call `oats use`; layer-wide
disable is distinct from excluding a single capability, and is available only
when inspecting a workspace or member scope, never an individual soul. These changes apply to
future instances. Existing homes retain their captured bindings and settings.

Authored souls expose only the fields the kernel reports as editable. Desktop
edits runtime, model, backend, YOLO, description and instructions through
`oats soul set`. Packaged souls remain read-only and explain where their source
must be changed. Instructions use a private temporary file; the CLI owns remote
transfer and mutation. Desktop does not modify YAML or resolve capabilities.

An instance's action menu opens Knowledge & capabilities. The kernel supplies
its snapshot, differences from current configuration, and declared provider
operations. View operations return labeled documents; Desktop renders their
text and treats remote paths as provenance, never as local files to open. Actions
without required arguments can run here. Operations requiring arguments explain
that they need the CLI. No provider is assumed to support harvesting.

Schedules store an operation address and exact home with the kernel's generic
`operation` job kind. The form discovers declared, available actions on demand.
The server verifies that declaration again at save time, and the kernel resolves
and validates the provider at execution time. Existing command schedules remain
visible and runnable, but the GUI does not reverse-parse their argv to edit them.

Every capability request requires an exact advertised workspace. Remote requests
require its saved server registration and the CLI's operations API feature; all
routing stays in OATS. The consumer never performs SSH or silently substitutes a
local workspace. The proxy allows the CLI's bounded operation to return its
receipt before timing out.

Validation: scope/identity and remote-route refusal; private instructions and
failure cleanup; declared schedule actions; stale inspection/save responses;
provider text rendering; explicit launch and existing runtime flows. Native
Electron rendering is checked with a temporary fixture frame in the existing
GUI, without starting a model, agent, or another application instance.
