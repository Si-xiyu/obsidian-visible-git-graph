import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';

describe('DEFAULT_SETTINGS', () => {
  it('matches the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      gitPath: 'git',
      pageSize: 200,
      refFilter: 'local',
      dateFormat: 'DD Mon YYYY HH:mm',
    });
  });
});

describe('normalizeSettings', () => {
  it('returns the defaults for missing data', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('returns a new object instead of DEFAULT_SETTINGS', () => {
    const settings = normalizeSettings(undefined);
    expect(settings).not.toBe(DEFAULT_SETTINGS);
    settings.gitPath = '/custom/git';
    expect(DEFAULT_SETTINGS.gitPath).toBe('git');
  });

  it('keeps valid values and supports absolute git paths', () => {
    const settings = normalizeSettings({
      gitPath: 'C:\\Program Files\\Git\\cmd\\git.exe',
      pageSize: 500,
      refFilter: 'all',
      dateFormat: 'YYYY-MM-DD HH:mm:ss',
    });
    expect(settings).toEqual({
      gitPath: 'C:\\Program Files\\Git\\cmd\\git.exe',
      pageSize: 500,
      refFilter: 'all',
      dateFormat: 'YYYY-MM-DD HH:mm:ss',
    });
  });

  it('falls back to "git" for empty or whitespace-only gitPath', () => {
    expect(normalizeSettings({ gitPath: '' }).gitPath).toBe('git');
    expect(normalizeSettings({ gitPath: '   ' }).gitPath).toBe('git');
    expect(normalizeSettings({ gitPath: '  /usr/bin/git  ' }).gitPath).toBe('/usr/bin/git');
  });

  it('truncates and clamps pageSize into 10–5000', () => {
    expect(normalizeSettings({ pageSize: 5 }).pageSize).toBe(10);
    expect(normalizeSettings({ pageSize: 0 }).pageSize).toBe(10);
    expect(normalizeSettings({ pageSize: -100 }).pageSize).toBe(10);
    expect(normalizeSettings({ pageSize: 9.9 }).pageSize).toBe(10);
    expect(normalizeSettings({ pageSize: 10 }).pageSize).toBe(10);
    expect(normalizeSettings({ pageSize: 50_000 }).pageSize).toBe(5000);
    expect(normalizeSettings({ pageSize: 200.9 }).pageSize).toBe(200);
  });

  it('falls back to the default page size for non-numeric values', () => {
    expect(normalizeSettings({ pageSize: Number.NaN }).pageSize).toBe(200);
    expect(normalizeSettings({ pageSize: Number.POSITIVE_INFINITY }).pageSize).toBe(200);
    expect(
      normalizeSettings({ pageSize: '300' as unknown as number }).pageSize,
    ).toBe(200);
  });

  it('accepts local/all and migrates the legacy auto value', () => {
    expect(normalizeSettings({ refFilter: 'all' }).refFilter).toBe('all');
    expect(normalizeSettings({ refFilter: 'auto' as 'local' }).refFilter).toBe('local');
    expect(normalizeSettings({ refFilter: 'local' }).refFilter).toBe('local');
    expect(normalizeSettings({ refFilter: 'off' as 'local' }).refFilter).toBe('local');
    expect(normalizeSettings({ refFilter: 'ALL' as 'all' }).refFilter).toBe('local');
  });

  it('falls back to the default date format for empty strings', () => {
    expect(normalizeSettings({ dateFormat: '' }).dateFormat).toBe('DD Mon YYYY HH:mm');
    expect(normalizeSettings({ dateFormat: '   ' }).dateFormat).toBe('DD Mon YYYY HH:mm');
    expect(normalizeSettings({ dateFormat: 'DD/MM/YYYY' }).dateFormat).toBe('DD/MM/YYYY');
  });

  it('keeps the other values when only one field is patched', () => {
    const settings = normalizeSettings({ pageSize: 300 });
    expect(settings).toEqual({
      gitPath: 'git',
      pageSize: 300,
      refFilter: 'local',
      dateFormat: 'DD Mon YYYY HH:mm',
    });
  });
});
