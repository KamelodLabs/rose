import { createElement } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: ({ src, alt, width, height, className }: ImgHTMLAttributes<HTMLImageElement>) =>
    createElement('img', { src, alt, width, height, className }),
}));

import Home from '@/app/page';

describe('Home', () => {
  it('renders the starter heading and primary links', () => {
    render(<Home />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('To get started');
    expect(heading.textContent).toContain('page.tsx');

    expect(screen.getByRole('link', { name: /Deploy Now/ })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Documentation' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Templates' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Learning' })).toBeDefined();
  });
});
