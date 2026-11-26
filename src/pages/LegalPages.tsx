import { FileText, ShieldCheck } from 'lucide-react'
import { Card, Notice, PageHeader } from '../components/ui'

/**
 * Klargjorte maler. Innholdet MÅ gjennomgås og fullføres (behandlingsansvarlig,
 * kontaktinfo, databehandlere, lagringstid) før appen settes i produksjon.
 */
export function PrivacyPage() {
  return (
    <>
      <PageHeader title="Personvernerklæring" />
      <Notice tone="warn">Utkast – må fullføres og kvalitetssikres før lansering.</Notice>
      <Card title="Hvilke opplysninger vi behandler" icon={ShieldCheck}>
        <ul>
          <li><strong>Konto:</strong> navn, e-postadresse, kontotype og tidspunkt for godkjente vilkår.</li>
          <li><strong>Organisasjon:</strong> navn, medlemmer og roller.</li>
          <li><strong>Innhold du lagrer:</strong> oppskrifter, ingredienser og priser, strømoppsett og bakehistorikk.</li>
          <li><strong>Abonnement:</strong> plan, status og prøveperiode.</li>
        </ul>
        <p>Uten innlogging lagres alt kun lokalt i nettleseren din.</p>
      </Card>
      <Card title="Formål, lagring og rettigheter" icon={FileText}>
        <p>Opplysningene brukes for å levere tjenesten. Data lagres hos [databehandler: Supabase, region] og deles ikke med andre for markedsføring.</p>
        <p>Strømpriser hentes fra hvakosterstrommen.no uten at personopplysninger sendes med.</p>
        <p>Du kan når som helst laste ned dataene dine og slette kontoen under <a href="#/konto">Konto</a>. Sletting fjerner profilen og organisasjoner der du er eneste medlem.</p>
        <p>Behandlingsansvarlig: [navn, org.nr., kontaktadresse]. Du kan klage til Datatilsynet.</p>
      </Card>
    </>
  )
}

export function TermsPage() {
  return (
    <>
      <PageHeader title="Brukervilkår" />
      <Notice tone="warn">Utkast – må fullføres og kvalitetssikres før lansering.</Notice>
      <Card title="Tjenesten" icon={FileText}>
        <p>Rett i lomma – Bakekalkulator gir estimater for strøm- og ingredienskostnader. Beregningene er veiledende og avhenger av opplysningene du legger inn og offentlige satser som kan endres.</p>
        <p>Nye kunder får 30 dagers prøveperiode med Pro. Etter prøveperioden gjelder Free med mindre et betalt abonnement er aktivt. Dataene dine slettes ikke når prøveperioden går ut.</p>
        <p>[Pris, betaling, oppsigelse, ansvarsbegrensning, endringer i vilkår og kontaktinformasjon fylles inn.]</p>
      </Card>
    </>
  )
}
