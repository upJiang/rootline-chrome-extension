import {
  BoxSelect,
  Check,
  CircleAlert,
  Code2,
  Cookie,
  FileArchive,
  Globe2,
  HardDrive,
  Network,
  Play,
  ShieldCheck,
  TerminalSquare,
  Video,
} from "lucide-react"
import { useEffect } from "react"
import { Brand } from "../../components/Brand"
import { LocaleToggle, useI18n } from "../../components/LocaleToggle"
import { t, type MessageKey } from "../../src/lib/i18n"

const evidence = [
  { icon: Globe2, title: "instructionsEvidencePage", description: "instructionsEvidencePageDetail" },
  { icon: BoxSelect, title: "instructionsEvidenceTargets", description: "instructionsEvidenceTargetsDetail" },
  { icon: TerminalSquare, title: "instructionsEvidenceConsole", description: "instructionsEvidenceConsoleDetail" },
  { icon: Network, title: "instructionsEvidenceNetwork", description: "instructionsEvidenceNetworkDetail" },
  { icon: Video, title: "instructionsEvidenceVideo", description: "instructionsEvidenceVideoDetail" },
] as const

const steps = [
  ["instructionsStep1Title", "instructionsStep1Detail"],
  ["instructionsStep2Title", "instructionsStep2Detail"],
  ["instructionsStep3Title", "instructionsStep3Detail"],
  ["instructionsStep4Title", "instructionsStep4Detail"],
  ["instructionsStep5Title", "instructionsStep5Detail"],
  ["instructionsStep6Title", "instructionsStep6Detail"],
] as const satisfies ReadonlyArray<readonly [MessageKey, MessageKey]>

export function InstructionsApp() {
  const { locale } = useI18n()
  useEffect(() => {
    document.title = t("instructionsDocumentTitle")
  }, [locale])

  return (
    <main className="instructions-shell">
      <header className="instructions-header">
        <div className="instructions-inner">
          <div className="instructions-header-bar">
            <Brand />
            <LocaleToggle />
          </div>
          <p className="instructions-kicker">{t("instructionsKicker")}</p>
          <h1>{t("instructionsTitle")}</h1>
          <p className="instructions-lead">{t("instructionsLead")}</p>
        </div>
      </header>

      <div className="instructions-inner instructions-content">
        <aside className="instructions-callout">
          <CircleAlert aria-hidden="true" size={20} />
          <div><h2>{t("instructionsCalloutTitle")}</h2><p>{t("instructionsCalloutDetail")}</p></div>
        </aside>

        <section aria-labelledby="workflow-title" className="instructions-section">
          <SectionHeading eyebrow={t("instructionsWorkflowEyebrow")} id="workflow-title" title={t("instructionsWorkflowTitle")} />
          <ol className="workflow-steps">
            {steps.map(([title, description], index) => (
              <li key={title}>
                <span>{index + 1}</span>
                <div><h3>{t(title)}</h3><p>{t(description)}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="evidence-title" className="instructions-section">
          <SectionHeading eyebrow={t("instructionsEvidenceEyebrow")} id="evidence-title" title={t("instructionsEvidenceTitle")} />
          <div className="evidence-guide">
            {evidence.map(({ description, icon: Icon, title }) => (
              <article key={title}><Icon aria-hidden="true" size={19} /><h3>{t(title)}</h3><p>{t(description)}</p></article>
            ))}
          </div>
        </section>

        <section aria-labelledby="privacy-title" className="instructions-section">
          <SectionHeading eyebrow={t("instructionsPrivacyEyebrow")} id="privacy-title" title={t("instructionsPrivacyTitle")} />
          <div className="privacy-grid">
            <article>
              <ShieldCheck aria-hidden="true" size={20} />
              <div><h3>{t("instructionsRedaction")}</h3><p>{t("instructionsRedactionDetail")}</p></div>
            </article>
            <article>
              <HardDrive aria-hidden="true" size={20} />
              <div><h3>{t("instructionsSaveModes")}</h3><p>{t("instructionsSaveModesDetail")}</p></div>
            </article>
            <article>
              <Cookie aria-hidden="true" size={20} />
              <div><h3>{t("instructionsNotCollected")}</h3><p>{t("instructionsNotCollectedDetail")}</p></div>
            </article>
          </div>
        </section>

        <section aria-labelledby="output-title" className="instructions-section">
          <SectionHeading eyebrow={t("instructionsOutputEyebrow")} id="output-title" title={t("instructionsOutputTitle")} />
          <div className="output-row">
            <FileArchive aria-hidden="true" size={22} />
            <div><h3>rootline-capture-YYYY-MM-DD_HH-mm-ss-&lt;id&gt;</h3><p>{t("instructionsOutputDetail")}</p></div>
          </div>
          <ul className="tip-list">
            <li><Check aria-hidden="true" size={16} /><span>{t("instructionsTip1")}</span></li>
            <li><Check aria-hidden="true" size={16} /><span>{t("instructionsTip2")}</span></li>
            <li><Check aria-hidden="true" size={16} /><span>{t("instructionsTip3")}</span></li>
            <li><Check aria-hidden="true" size={16} /><span>{t("instructionsTip4")}</span></li>
          </ul>
        </section>

        <footer className="instructions-footer">
          <Play aria-hidden="true" size={16} /><span>{t("instructionsFooter")}</span><Code2 aria-hidden="true" size={16} />
        </footer>
      </div>
    </main>
  )
}

function SectionHeading({ eyebrow, id, title }: { eyebrow: string; id: string; title: string }) {
  return <div className="section-heading"><p>{eyebrow}</p><h2 id={id}>{title}</h2></div>
}
