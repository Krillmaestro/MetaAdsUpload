import { metaApi, getAdAccountId } from "./client";

export async function uploadImage(imageFile: Buffer, filename: string) {
  const form = new FormData();
  form.append("filename", filename);
  form.append("bytes", new Blob([new Uint8Array(imageFile)]), filename);
  return metaApi<{ images: Record<string, { hash: string }> }>(
    `/${getAdAccountId()}/adimages`,
    { method: "POST", body: form }
  );
}

export async function uploadVideo(videoFile: Buffer, filename: string) {
  const form = new FormData();
  form.append("title", filename);
  form.append("source", new Blob([new Uint8Array(videoFile)]), filename);
  return metaApi<{ id: string }>(
    `/${getAdAccountId()}/advideos`,
    { method: "POST", body: form }
  );
}

export async function createAdCreative(params: {
  name: string;
  object_story_spec: {
    page_id: string;
    link_data?: {
      link: string;
      message?: string;
      name?: string;
      description?: string;
      call_to_action?: { type: string };
      image_hash?: string;
    };
    video_data?: {
      video_id: string;
      title?: string;
      message?: string;
      link_description?: string;
      call_to_action?: { type: string; value: { link: string } };
      image_hash?: string;
    };
  };
  asset_feed_spec?: {
    titles?: Array<{ text: string }>;
    bodies?: Array<{ text: string }>;
    descriptions?: Array<{ text: string }>;
    link_urls?: Array<{ website_url: string }>;
    call_to_action_types?: string[];
    images?: Array<{ hash: string }>;
    videos?: Array<{ video_id: string }>;
  };
  degrees_of_freedom_spec?: {
    creative_features_spec: {
      standard_enhancements: { enroll_status: string };
    };
  };
}) {
  return metaApi<{ id: string }>(`/${getAdAccountId()}/adcreatives`, {
    method: "POST",
    body: params,
  });
}
