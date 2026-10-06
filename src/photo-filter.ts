import type { PhotoAsset } from "./types";

export type PhotoDirection = "all" | "landscape" | "portrait" | "square";
export type PhotoFilter = { query: string; direction: PhotoDirection };
export const emptyPhotoFilter: PhotoFilter = { query: "", direction: "all" };
const normalize = (value: string) => value.normalize("NFKC").toLowerCase();

export function filterPhotos<T extends Pick<PhotoAsset, "fileName" | "width" | "height">>(photos: T[], filter: PhotoFilter): T[] {
  const query = normalize(filter.query.trim());
  return photos.filter(photo => {
    const direction = photo.width === photo.height ? "square" : photo.width > photo.height ? "landscape" : "portrait";
    return (filter.direction === "all" || filter.direction === direction) && normalize(photo.fileName).includes(query);
  });
}

export function selectVisiblePhotos(selected: string[], visible: string[], action: "all" | "invert" | "none"): string[] {
  const next = new Set(selected);
  for (const id of new Set(visible)) {
    if (action === "none" || (action === "invert" && next.has(id))) next.delete(id);
    else next.add(id);
  }
  return [...next];
}
