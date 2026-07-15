import { createHash } from "node:crypto";

export const reconciliationArtifactVersion = 1;

export function splitAlbumIds(value) {
  return String(value ?? "").split(";").map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function orderedAlbumIds(values, albumOrder) {
  const order = new Map(albumOrder.map((albumId, index) => [albumId, index]));
  return unique(values).sort((left, right) =>
    (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right),
  );
}

export function photoStateSha256(photos) {
  return createHash("sha256")
    .update(JSON.stringify(photos.map((photo) => [String(photo.photo_id ?? ""), String(photo.album_ids ?? "")])))
    .digest("hex");
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function baselineMembership(inventories) {
  const memberships = new Map();
  for (const inventory of inventories) {
    for (const photoId of inventory.photoIds) {
      const albumIds = memberships.get(photoId) ?? [];
      albumIds.push(inventory.albumId);
      memberships.set(photoId, albumIds);
    }
  }
  return memberships;
}

function desiredAlbumOrder({ albumOrder, inventories, nextAlbumsByPhotoId, photos, scope }) {
  if (scope === "catalog") {
    return unique(inventories.flatMap((inventory) => inventory.photoIds));
  }

  const selectedInventory = inventories[0];
  const selectedAlbumId = selectedInventory.albumId;
  const groups = new Map(albumOrder.map((albumId) => [albumId, []]));
  const unknown = [];

  for (const photo of photos) {
    const photoId = String(photo.photo_id ?? "");
    const canonicalAlbumId = nextAlbumsByPhotoId.get(photoId)?.[0];
    if (!canonicalAlbumId) {
      continue;
    }
    if (groups.has(canonicalAlbumId)) {
      groups.get(canonicalAlbumId).push(photoId);
    } else {
      unknown.push(photoId);
    }
  }

  groups.set(
    selectedAlbumId,
    selectedInventory.photoIds.filter((photoId) => nextAlbumsByPhotoId.get(photoId)?.[0] === selectedAlbumId),
  );
  return [...albumOrder.flatMap((albumId) => groups.get(albumId) ?? []), ...unknown];
}

export function buildPhotoReconciliation({
  albumOrder,
  contextsByPhotoId = new Map(),
  inventories,
  photos,
  scope = "album",
} = {}) {
  if (!Array.isArray(albumOrder) || albumOrder.length === 0) {
    throw new Error("albumOrder is required");
  }
  if (!Array.isArray(inventories) || inventories.length === 0) {
    throw new Error("inventories are required");
  }
  if (!Array.isArray(photos)) {
    throw new Error("photos are required");
  }
  if (scope === "album" && inventories.length !== 1) {
    throw new Error("album reconciliation requires exactly one inventory");
  }

  const sourceIds = new Set();
  for (const photo of photos) {
    const photoId = String(photo.photo_id ?? "");
    if (!photoId || sourceIds.has(photoId)) {
      throw new Error(`Duplicate or missing source photo_id: ${photoId || "(empty)"}`);
    }
    sourceIds.add(photoId);
  }

  const managedAlbums = new Set(albumOrder);
  const baseline = scope === "catalog" ? baselineMembership(inventories) : null;
  const selectedInventory = inventories[0];
  const selectedIds = new Set(selectedInventory.photoIds);
  const nextAlbumsByPhotoId = new Map();
  const membershipUpdates = [];
  const deletedPhotoIds = [];

  for (const photo of photos) {
    const photoId = String(photo.photo_id);
    const before = splitAlbumIds(photo.album_ids);
    let after = before;

    if (scope === "catalog") {
      after = baseline.get(photoId) ?? [];
    } else if (selectedIds.has(photoId)) {
      after = [...before, selectedInventory.albumId];
    } else if (before.includes(selectedInventory.albumId)) {
      after = before.filter((albumId) => albumId !== selectedInventory.albumId);
      if (after.length === 0) {
        after = (contextsByPhotoId.get(photoId) ?? []).filter((albumId) => managedAlbums.has(albumId));
      }
    }

    after = orderedAlbumIds(after, albumOrder);
    nextAlbumsByPhotoId.set(photoId, after);
    if (!sameValues(before, after)) {
      membershipUpdates.push({
        after_album_ids: after,
        before_album_ids: before,
        photo_id: photoId,
      });
    }
    if (after.length === 0) {
      deletedPhotoIds.push(photoId);
    }
  }

  const inventoryIds = unique(inventories.flatMap((inventory) => inventory.photoIds));
  const newPhotoIds = inventoryIds.filter((photoId) => !sourceIds.has(photoId));
  for (const photoId of newPhotoIds) {
    const albumIds = scope === "catalog"
      ? orderedAlbumIds(baseline.get(photoId) ?? [], albumOrder)
      : [selectedInventory.albumId];
    nextAlbumsByPhotoId.set(photoId, albumIds);
  }

  const remainingPhotos = [
    ...photos.filter((photo) => !deletedPhotoIds.includes(String(photo.photo_id))),
    ...newPhotoIds.map((photoId) => ({ photo_id: photoId })),
  ];
  const desiredPhotoIds = desiredAlbumOrder({
    albumOrder,
    inventories,
    nextAlbumsByPhotoId,
    photos: remainingPhotos,
    scope,
  });
  const expectedIds = new Set(remainingPhotos.map((photo) => String(photo.photo_id)));
  if (desiredPhotoIds.length !== expectedIds.size || desiredPhotoIds.some((photoId) => !expectedIds.has(photoId))) {
    throw new Error("Could not build a complete desired photo order");
  }

  const beforeOrder = remainingPhotos.map((photo) => String(photo.photo_id));
  const beforeIndex = new Map(beforeOrder.map((photoId, index) => [photoId, index]));
  const reorderedPhotoCount = desiredPhotoIds.filter((photoId, index) => beforeIndex.get(photoId) !== index).length;

  return {
    album_order: albumOrder,
    album_photos: inventories.map((inventory) => ({
      album_id: inventory.albumId,
      photo_ids: inventory.photoIds,
    })),
    artifact_version: reconciliationArtifactVersion,
    counts: {
      deleted: deletedPhotoIds.length,
      membership_updated: membershipUpdates.length,
      new: newPhotoIds.length,
      reordered: reorderedPhotoCount,
    },
    deleted_photo_ids: deletedPhotoIds,
    desired_photo_ids: desiredPhotoIds,
    membership_updates: membershipUpdates,
    new_photo_ids: newPhotoIds,
    scope,
    source_state_sha256: photoStateSha256(photos),
  };
}
