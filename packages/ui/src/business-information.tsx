import { useState } from 'react';
import { Info, MapPin, Phone, Mail, ExternalLink } from 'lucide-react';
import {
  businessAddress,
  businessPhone,
  readBusinessProfile,
} from '../../shared/src/business-profile.js';
import { Modal, ModalCloseButton } from './common.js';
export function BusinessInformation({ name, profile: raw }: { name: string; profile: unknown }) {
  const [open, setOpen] = useState(false),
    profile = readBusinessProfile(raw),
    address = businessAddress(profile);
  if (!Object.values(profile).some(Boolean)) return null;
  return (
    <>
      <button
        className="customer-about-button"
        onClick={() => setOpen(true)}
        aria-label="Sobre o estabelecimento"
      >
        <Info size={15} />
        Sobre
      </button>
      {open && (
        <Modal
          title={'Sobre ' + name}
          className="customer-business-modal"
          onClose={() => setOpen(false)}
        >
          <div className="customer-business-info">
            {profile.description && <p className="business-description">{profile.description}</p>}
            {address.length > 0 && (
              <section>
                <h3>
                  <MapPin size={18} />
                  Onde estamos
                </h3>
                <address className="business-address">
                  {address.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </address>
                {(profile.street || profile.city) && (
                  <a
                    className="pwa-launch-link"
                    href={
                      'https://www.google.com/maps/search/?api=1&query=' +
                      encodeURIComponent(address.join(', '))
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={15} />
                    Ver no mapa
                  </a>
                )}
              </section>
            )}
            {(profile.phone || profile.email) && (
              <section>
                <h3>
                  <Phone size={18} />
                  Fale com a gente
                </h3>
                <div className="customer-business-contact">
                  {profile.phone && (
                    <a href={'tel:+55' + profile.phone}>
                      <Phone size={16} />
                      {businessPhone(profile.phone)}
                    </a>
                  )}
                  {profile.email && (
                    <a href={'mailto:' + profile.email}>
                      <Mail size={16} />
                      {profile.email}
                    </a>
                  )}
                </div>
              </section>
            )}
          </div>
          <div className="modal-footer">
            <ModalCloseButton>Fechar</ModalCloseButton>
          </div>
        </Modal>
      )}
    </>
  );
}
