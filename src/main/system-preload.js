// Injected before React app loads inside systemView.
// Sets a flag so DashboardLayout knows not to render the built-in Electron titlebar
// (we have our own titlebarView + sidebarView handling that).
window.__IN_SYSTEM_VIEW = true;
