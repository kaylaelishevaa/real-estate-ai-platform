import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmDelete } from './ConfirmDelete';

describe('ConfirmDelete', () => {
  it('reveals a confirm step before firing onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmDelete onConfirm={onConfirm} />);

    // first click only arms the confirm — it must NOT delete yet
    fireEvent.click(screen.getByTestId('delete-button'));
    expect(screen.getByTestId('confirm-delete')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    // confirming fires the callback
    fireEvent.click(screen.getByTestId('confirm-delete-yes'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it('cancel backs out without calling onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDelete onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('delete-button'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByTestId('confirm-delete')).not.toBeInTheDocument();
    expect(screen.getByTestId('delete-button')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses a custom label', () => {
    render(<ConfirmDelete onConfirm={vi.fn()} label="Remove" />);
    expect(screen.getByTestId('delete-button')).toHaveTextContent('Remove');
  });
});
