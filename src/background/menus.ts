/**
 * The context menu.
 *
 * One item, and it sits on an image only. The region scan reaches the user
 * through the toolbar button and through the keyboard command instead, because a
 * second item on every right click of every page costs more than it gives.
 *
 * Chrome keeps the items of a previous run, so the installer removes every item
 * before it creates this list.
 */

export const MenuId = {
  ScanImage: "textlift:scan-image",
} as const;

export const MENU_ITEMS: readonly chrome.contextMenus.CreateProperties[] = [
  {
    id: MenuId.ScanImage,
    title: "Scan the text of this image",
    contexts: ["image"],
  },
];
