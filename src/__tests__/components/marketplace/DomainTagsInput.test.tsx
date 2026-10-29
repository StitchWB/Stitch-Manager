import { describe, it, expect, jest } from '@jest/globals';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { DomainTagsInput } from '@/components/marketplace/DomainTagsInput';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

function Harness({ initial = [] }: { initial?: string[] }) {
  const [tags, setTags] = useState(initial);
  return (
    <DomainTagsInput
      value={tags}
      onChange={setTags}
      placeholder="ph"
    />
  );
}

const input = () => screen.getByRole('textbox');

describe('DomainTagsInput', () => {
  it('commits a tag on Enter and clears the draft', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'example.com{Enter}');

    expect(screen.getByText('example.com')).toBeTruthy();
    expect(input()).toHaveValue('');
  });

  it('commits a tag on comma without inserting it', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'a.com,');

    expect(screen.getByText('a.com')).toBeTruthy();
    expect(input()).toHaveValue('');
  });

  it('commits a tag on space', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'a.com ');

    expect(screen.getByText('a.com')).toBeTruthy();
    expect(input()).toHaveValue('');
  });

  it('splits pasted text on comma and space into tags', () => {
    render(<Harness />);
    fireEvent.paste(input(), {
      clipboardData: { getData: () => 'a.com, b.com c.com' },
    });

    expect(screen.getByText('a.com')).toBeTruthy();
    expect(screen.getByText('b.com')).toBeTruthy();
    expect(screen.getByText('c.com')).toBeTruthy();
  });

  it('lowercases committed tags', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'EXAMPLE.com{Enter}');

    expect(screen.getByText('example.com')).toBeTruthy();
  });

  it('renders an invalid tag with rose ring classes and title', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'bad_domain{Enter}');

    const tag = screen.getByText('bad_domain');
    expect(tag).toHaveClass('ring-1', 'ring-rose-500/50', 'text-rose-300');
    expect(tag).toHaveAttribute('title', 'marketplace.submit.domainInvalid');
  });

  it('shows the inline invalid hint while the draft is invalid and hides it when valid', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'bad');

    expect(screen.getByText('marketplace.submit.domainInvalid')).toBeTruthy();

    await userEvent.type(input(), '.com');
    expect(
      screen.queryByText('marketplace.submit.domainInvalid'),
    ).toBeNull();
  });

  it('removes the last tag on Backspace with an empty draft', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'a.com{Enter}');
    await userEvent.type(input(), 'b.com{Enter}');
    await userEvent.type(input(), '{Backspace}');

    expect(screen.queryByText('b.com')).toBeNull();
    expect(screen.getByText('a.com')).toBeTruthy();
  });

  it('removes a tag via its X button', async () => {
    render(<Harness />);
    await userEvent.type(input(), 'a.com{Enter}');

    await userEvent.click(screen.getByRole('button', { name: 'Remove a.com' }));

    expect(screen.queryByText('a.com')).toBeNull();
  });
});
