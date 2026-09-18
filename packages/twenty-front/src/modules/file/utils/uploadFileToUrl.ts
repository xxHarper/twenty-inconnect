type UploadFileToUrlOptions = {
  file: File;
  uploadUrl: string;
  contentType: string;
  signal?: AbortSignal;
};

export const uploadFileToUrl = async ({
  file,
  uploadUrl,
  contentType,
  signal,
}: UploadFileToUrlOptions): Promise<void> => {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
    credentials: 'omit',
    signal,
  });

  if (!response.ok) {
    throw new Error(`File upload failed with status ${response.status}`);
  }
};
