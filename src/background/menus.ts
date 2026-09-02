/**
 * The context menu items.
 *
 * Chrome keeps the items of a previous run, so the installer removes every item
 * before it creates this list.
 */

export const MenuId = {
  ScanImage: "textlift:scan-image",
  ScanRegion: "textlift:scan-region",
} as const;

export const MENU_ITEMS: readonly chrome.contextMenus.CreateProperties[] = [
  {
    id: MenuId.ScanImage,
    title: "Scan the text of this image",
    contexts: ["image"],
  },
  {
    id: MenuId.ScanRegion,
    title: "Scan the text of a screen region",
    contexts: ["page", "image", "video", "frame", "selection", "link"],
  },
];
