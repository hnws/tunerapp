// UI toolkit: Shoelace (https://shoelace.style, MIT) web components through their React wrappers,
// imported one by one so only these end up in the bundle. Dark theme: <html class="sl-theme-dark">
// in index.html; app-specific overrides of Shoelace's tokens/parts live in App.tsx's <style> block.
import "@shoelace-style/shoelace/dist/themes/dark.css";

export { default as SlButton } from "@shoelace-style/shoelace/dist/react/button/index.js";
export { default as SlCheckbox } from "@shoelace-style/shoelace/dist/react/checkbox/index.js";
export { default as SlDetails } from "@shoelace-style/shoelace/dist/react/details/index.js";
export { default as SlDrawer } from "@shoelace-style/shoelace/dist/react/drawer/index.js";
export { default as SlInput } from "@shoelace-style/shoelace/dist/react/input/index.js";
export { default as SlOption } from "@shoelace-style/shoelace/dist/react/option/index.js";
export { default as SlRadioButton } from "@shoelace-style/shoelace/dist/react/radio-button/index.js";
export { default as SlRadioGroup } from "@shoelace-style/shoelace/dist/react/radio-group/index.js";
export { default as SlSelect } from "@shoelace-style/shoelace/dist/react/select/index.js";
export { default as SlTab } from "@shoelace-style/shoelace/dist/react/tab/index.js";
export { default as SlTabGroup } from "@shoelace-style/shoelace/dist/react/tab-group/index.js";

// Shoelace events carry the element as target; these read the value without casting at each site.
export function eventValue(event: Event): string {
  const value = (event.target as { value?: unknown } | null)?.value;
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export function eventChecked(event: Event): boolean {
  return Boolean((event.target as { checked?: unknown } | null)?.checked);
}

// sl-show / sl-hide bubble: a dropdown (sl-select) opening inside an sl-details would otherwise
// look like the details itself opening or closing. Only react to the element's own events.
export function isOwnEvent(event: Event): boolean {
  return event.target === event.currentTarget;
}
