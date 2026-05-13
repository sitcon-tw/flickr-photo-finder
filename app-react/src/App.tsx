import { useEffect, useMemo, useState } from "react";
import { loadFinderData } from "../../app-core/data-loader";

type PhotoRecord = Record<string, unknown> & {
  photo_id: string;
  photo_url: string;
  image_preview_url: string;
  album_title: string;
  event_name: string;
  event_year: string;
  recommended_uses: string[];
  scene_tags: string[];
  public_use_status: string;
  priority_level: string;
  curation_status: string;
  visual_description: string;
};

type FinderData = Awaited<ReturnType<typeof loadFinderData>>;

const previewDataSources = {
  albumsCsvUrl: "./fixtures/albums.csv",
  photosCsvUrl: "./fixtures/photos.csv",
  interfaceRegistryJsonUrl: "./data/interface-registry.json",
  schemaJsonUrl: "./data/photo-schema.json",
  taxonomyJsonUrl: "./data/tag-taxonomy.json",
  searchAliasesJsonUrl: "./data/search-aliases.json",
};

function photoTitle(photo: PhotoRecord) {
  return photo.event_name || photo.album_title || photo.photo_id;
}

function statusText(photo: PhotoRecord) {
  return [photo.public_use_status, photo.priority_level, photo.curation_status].filter(Boolean).join(" / ");
}

function PhotoCard({ photo }: { photo: PhotoRecord }) {
  return (
    <article className="photo-card">
      {photo.image_preview_url ? (
        <img src={photo.image_preview_url} alt={photoTitle(photo)} loading="lazy" decoding="async" />
      ) : (
        <div className="photo-card__empty">No preview</div>
      )}
      <div className="photo-card__body">
        <div className="photo-card__meta">{[photo.event_year, photo.album_title].filter(Boolean).join(" / ")}</div>
        <h2>{photoTitle(photo)}</h2>
        <p>{photo.visual_description || "尚無畫面描述"}</p>
        <dl>
          <div>
            <dt>用途</dt>
            <dd>{photo.recommended_uses.slice(0, 2).join("、") || "未填"}</dd>
          </div>
          <div>
            <dt>場景</dt>
            <dd>{photo.scene_tags.slice(0, 2).join("、") || "未填"}</dd>
          </div>
        </dl>
        <div className="photo-card__footer">
          <span>{statusText(photo)}</span>
          <a href={photo.photo_url}>Flickr</a>
        </div>
      </div>
    </article>
  );
}

export function App() {
  const [data, setData] = useState<FinderData | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    loadFinderData({
      dataSources: previewDataSources,
      projectConfigUrl: "./config/project.json",
    })
      .then((loadedData) => {
        if (!cancelled) {
          setData(loadedData);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "資料載入失敗");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const photos = useMemo(() => (data?.photos ?? []) as PhotoRecord[], [data]);
  const previewPhotos = photos.slice(0, 12);

  return (
    <main className="finder-shell">
      <header className="finder-header">
        <p className="finder-kicker">React preview artifact</p>
        <h1>SITCON Flickr Photo Finder</h1>
        <p>
          React shell is reading the same public contracts and fixture CSV through the migrated TypeScript core. The
          formal Pages artifact remains the vanilla finder until cutover.
        </p>
      </header>

      <section className="finder-status" aria-live="polite">
        {error ? (
          <strong>資料載入失敗：{error}</strong>
        ) : data ? (
          <>
            <strong>{photos.length} 張照片</strong>
            <span>{data.albums.length} 個相簿</span>
            <span>{data.photoSchema.tables.photos.fields.length} 個照片欄位</span>
          </>
        ) : (
          <strong>載入資料中</strong>
        )}
      </section>

      <section className="photo-grid" aria-label="照片預覽">
        {previewPhotos.map((photo) => (
          <PhotoCard key={photo.photo_id} photo={photo} />
        ))}
      </section>
    </main>
  );
}
