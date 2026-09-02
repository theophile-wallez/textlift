/**
 * The copy of the result text.
 *
 * `navigator.clipboard` needs the focus of the document and a permission that a
 * page can refuse. `document.execCommand` is deprecated and it still works in
 * every Chrome version, so it serves as the fallback.
 */

export const copyText = async (text: string): Promise<boolean> => {
  if (text === "") return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
};

const legacyCopy = (text: string): boolean => {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";

  document.body.append(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
};
