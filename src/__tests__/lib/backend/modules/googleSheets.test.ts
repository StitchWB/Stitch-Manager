import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  deleteGoogleSheetsLink,
  fetchGoogleSheetsDataset,
  initGoogleSheetsSchema,
  normalizeSpreadsheetId,
  testGoogleSheetsConnection,
  deleteGoogleSheetsAccountAuthLink,
  deleteGoogleSheetsAccountLink,
  deleteGoogleSheetsAuthMethod,
  deleteGoogleSheetsProfileLink,
  upsertGoogleSheetsLink,
  upsertGoogleSheetsAccountAuthLink,
  upsertGoogleSheetsAccountLink,
  upsertGoogleSheetsAuthMethod,
  upsertGoogleSheetsProfileLink,
} from '../../../../lib/backend/modules/googleSheets';

const originalFetch = globalThis.fetch;

const mockFetchSequence = (responses: unknown[]) => {
  let idx = 0;
  globalThis.fetch = jest.fn<any>().mockImplementation(() => {
    const data = responses[idx++];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  }) as unknown as typeof fetch;
};

describe('lib/Backend/modules/googleSheets relation commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('normalizes spreadsheet id for all relation commands', async () => {
    const spreadsheetUrl =
      'https://docs.google.com/spreadsheets/d/1EztBcMPiM6WROzYuo67Cg6MCIUICUkZBgaF3A1zuliU/edit?gid=0#gid=0';
    const normalizedId = '1EztBcMPiM6WROzYuo67Cg6MCIUICUkZBgaF3A1zuliU';

    mockFetchSequence([
      [{ key: 'account_link_id', value: 'al-1' }],
      true,
      [{ key: 'profile_link_id', value: 'pl-1' }],
      true,
      [{ key: 'auth_method_id', value: 'am-1' }],
      true,
      [{ key: 'account_auth_link_id', value: 'aal-1' }],
      true,
    ]);

    await upsertGoogleSheetsAccountLink({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      link: [{ key: 'from_account_provider', value: 'gmail' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/upsert_google_sheets_account_link',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          link: [{ key: 'from_account_provider', value: 'gmail' }],
        }),
      }),
    );

    await deleteGoogleSheetsAccountLink({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      accountLinkId: 'al-1',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/delete_google_sheets_account_link',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          accountLinkId: 'al-1',
        }),
      }),
    );

    await upsertGoogleSheetsProfileLink({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      link: [{ key: 'profile_alias', value: 'profile-main' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/upsert_google_sheets_profile_link',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          link: [{ key: 'profile_alias', value: 'profile-main' }],
        }),
      }),
    );

    await deleteGoogleSheetsProfileLink({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      profileLinkId: 'pl-1',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/delete_google_sheets_profile_link',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          profileLinkId: 'pl-1',
        }),
      }),
    );

    await upsertGoogleSheetsAuthMethod({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      method: [{ key: 'auth_type', value: 'api_key' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/upsert_google_sheets_auth_method',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          method: [{ key: 'auth_type', value: 'api_key' }],
        }),
      }),
    );

    await deleteGoogleSheetsAuthMethod({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      authMethodId: 'am-1',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/delete_google_sheets_auth_method',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          authMethodId: 'am-1',
        }),
      }),
    );

    await upsertGoogleSheetsAccountAuthLink({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      link: [{ key: 'auth_method_id', value: 'am-1' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/upsert_google_sheets_account_auth_link',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          link: [{ key: 'auth_method_id', value: 'am-1' }],
        }),
      }),
    );

    await deleteGoogleSheetsAccountAuthLink({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      accountAuthLinkId: 'aal-1',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/delete_google_sheets_account_auth_link',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          accountAuthLinkId: 'aal-1',
        }),
      }),
    );
  });

  it('normalizes spreadsheet id for base sheets commands', async () => {
    const spreadsheetUrl =
      'https://docs.google.com/spreadsheets/u/1/d/1AbCDefGhIJKLmNoPQrStuVwXyZ-1234567890/edit?usp=sharing';
    const normalizedId = '1AbCDefGhIJKLmNoPQrStuVwXyZ-1234567890';

    mockFetchSequence([
      [{ key: 'link_id', value: 'l-1' }],
      true,
      { ok: true, spreadsheetId: normalizedId, title: 'sheet', sheets: [], warnings: [] },
      {
        spreadsheetId: normalizedId,
        title: 'sheet',
        identities: [],
        links: [],
        accountLinks: [],
        profileLinks: [],
        authMethods: [],
        accountAuthLinks: [],
        services: [],
        invalidRows: [],
        schemaIssues: [],
      },
      { ok: true, spreadsheetId: normalizedId, title: 'sheet', sheets: [], warnings: [] },
    ]);

    await upsertGoogleSheetsLink({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      link: [{ key: 'from_provider', value: 'gmail' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/upsert_google_sheets_link',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          link: [{ key: 'from_provider', value: 'gmail' }],
        }),
      }),
    );

    await deleteGoogleSheetsLink({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
      linkId: 'l-1',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/delete_google_sheets_link',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
          linkId: 'l-1',
        }),
      }),
    );

    await testGoogleSheetsConnection({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/test_google_sheets_connection',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
        }),
      }),
    );

    await fetchGoogleSheetsDataset({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/fetch_google_sheets_dataset',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
        }),
      }),
    );

    await initGoogleSheetsSchema({
      spreadsheetId: spreadsheetUrl,
      serviceAccountJson: '{}',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/init_google_sheets_schema',
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: normalizedId,
          serviceAccountJson: '{}',
        }),
      }),
    );
  });
});

describe('normalizeSpreadsheetId', () => {
  it.each([
    [
      'https://docs.google.com/spreadsheets/d/1EztBcMPiM6WROzYuo67Cg6MCIUICUkZBgaF3A1zuliU/edit?gid=0#gid=0',
      '1EztBcMPiM6WROzYuo67Cg6MCIUICUkZBgaF3A1zuliU',
    ],
    [
      'docs.google.com/spreadsheets/u/0/d/1AbCDefGhIJKLmNoPQrStuVwXyZ-1234567890/copy',
      '1AbCDefGhIJKLmNoPQrStuVwXyZ-1234567890',
    ],
    [
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vTestSpreadSheetKey/pubhtml',
      '2PACX-1vTestSpreadSheetKey',
    ],
    ['https://docs.google.com/open?id=1OpenIdFormatSpreadSheet123', '1OpenIdFormatSpreadSheet123'],
    ['  1RawSpreadsheetId_ABC-123  ', '1RawSpreadsheetId_ABC-123'],
  ])('extracts spreadsheet id from "%s"', (input, expected) => {
    expect(normalizeSpreadsheetId(input)).toBe(expected);
  });

  it('returns trimmed original value when format is unknown', () => {
    expect(normalizeSpreadsheetId('  not-a-google-sheets-link  ')).toBe('not-a-google-sheets-link');
  });
});
