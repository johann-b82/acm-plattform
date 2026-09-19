import "@testing-library/jest-dom/vitest";

// jsdom kennt <dialog>.showModal/close nicht. Ein schlanker Polyfill, damit
// Tests einen Dialog öffnen können; setzt nur `.open` und meldet `close`.
if (
  typeof HTMLDialogElement !== "undefined" &&
  !HTMLDialogElement.prototype.showModal
) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
