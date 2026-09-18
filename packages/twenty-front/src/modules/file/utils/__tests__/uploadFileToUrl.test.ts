import { uploadFileToUrl } from '@/file/utils/uploadFileToUrl';

const fetchMock = jest.fn();

describe('uploadFileToUrl', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchMock,
    });
  });

  afterEach(() => {
    fetchMock.mockReset();
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('uploads the File to the exact provided URL with the requested content type', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
    const file = new File(['content'], 'document.pdf', {
      type: 'application/pdf',
    });
    const abortController = new AbortController();
    const uploadUrl =
      'https://storage.example.test/exact-target?signature=preserved';

    await uploadFileToUrl({
      file,
      uploadUrl,
      contentType: 'application/octet-stream',
      signal: abortController.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      credentials: 'omit',
      signal: abortController.signal,
    });
  });

  it('preserves the existing non-success status error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(
      uploadFileToUrl({
        file: new File(['content'], 'document.pdf'),
        uploadUrl: 'https://storage.example.test/exact-target',
        contentType: 'application/octet-stream',
      }),
    ).rejects.toThrow('File upload failed with status 403');
  });
});
