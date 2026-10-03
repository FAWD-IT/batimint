import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Chip, EmptyState, Gauge, StepBar, TextField } from './index';

afterEach(cleanup);

describe('design system — accessibilité de base', () => {
  it('un bouton en chargement est désactivé et annoncé', () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Enregistrement…" onClick={onClick}>
        Enregistrer
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Enregistrer/ });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('status', { name: 'Enregistrement…' })).toBeTruthy();
  });

  it('un champ relie son libellé et son erreur', () => {
    render(<TextField label="Adresse e-mail" error="Adresse invalide" />);
    const input = screen.getByLabelText('Adresse e-mail');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Adresse invalide',
    );
  });

  it('la jauge expose sa valeur, bornée à la piste', () => {
    render(<Gauge value={1.4} label="Consommation du budget" tone="warn" />);
    const bar = screen.getByRole('progressbar', { name: 'Consommation du budget' });
    expect(bar.getAttribute('aria-valuenow')).toBe('140');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%');
  });

  it('la barre d’étapes signale l’étape courante', () => {
    render(
      <StepBar
        label="Avancement"
        steps={['Devis signé', 'Travaux', 'Réception', 'Facture finale', 'Payé']}
        current={1}
        progress={0.62}
      />,
    );
    expect(screen.getByText('Travaux').getAttribute('aria-current')).toBe('step');
  });

  it('une pastille porte toujours un libellé, l’état vide propose une action', () => {
    render(
      <>
        <Chip tone="warn" dot>
          Dérive
        </Chip>
        <EmptyState title="Aucun chantier" action={<button type="button">Créer un devis</button>} />
      </>,
    );
    expect(screen.getByText('Dérive')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Créer un devis' })).toBeTruthy();
  });
});
