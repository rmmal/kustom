import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  readTheme,
  THEME_COLOR,
  THEME_LABELS,
  THEME_PICKER_LABEL,
  THEME_STORAGE_KEY,
} from '@/lib/theme';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'night';
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it('marks Night by default and offers Day', async () => {
    render(<ThemeToggle />);

    expect(screen.getByRole('group', { name: THEME_PICKER_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: THEME_LABELS.night })).toBeChecked();
    expect(screen.getByRole('radio', { name: THEME_LABELS.day })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Current' })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: THEME_LABELS.night })).toBeChecked();
    });
  });

  it('follows the document theme after mount, so a refresh cannot disagree', async () => {
    document.documentElement.dataset.theme = 'day';
    render(<ThemeToggle />);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: THEME_LABELS.day })).toBeChecked();
    });
    expect(screen.getByRole('radio', { name: THEME_LABELS.night })).not.toBeChecked();
  });

  it('writes Day onto the document and into localStorage', async () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('radio', { name: THEME_LABELS.day }));

    expect(screen.getByRole('radio', { name: THEME_LABELS.day })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('day');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('day');
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: THEME_LABELS.day })).toBeChecked();
    });
  });
});

describe('applyTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_STORAGE_KEY);
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.remove();
    }
  });

  it('writes data-theme and localStorage', () => {
    applyTheme('day');

    expect(document.documentElement.dataset.theme).toBe('day');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('day');
    expect(readTheme()).toBe('day');
  });

  it('updates theme-color when the meta tag is present', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.append(meta);

    applyTheme('day');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.day);

    applyTheme('night');
    expect(meta.getAttribute('content')).toBe(THEME_COLOR.night);
  });
});
