import { ReactNode } from "react";
import { Card, CardBody, CardHeader, Chip } from "../../design";
import { MDPP_PROJECT, type ProjectConfig } from "./config";
import s from "./ProjectBanner.module.css";

export interface ProjectBannerProps {
  /** Defaults to the shared `MDPP_PROJECT`. */
  config?: ProjectConfig;
  /** `services[].key` of the app showing this — gets a "you are here" chip. */
  currentService?: string;
  /** The ONE app-specific line, under the description. Keep it to a sentence. */
  appNote?: ReactNode;
}

/**
 * The project-information banner, shared by every mDPP front-end so the
 * description, partners, funding and contacts are written once. Presentation
 * only — it fetches nothing.
 */
export function ProjectBanner({ config = MDPP_PROJECT, currentService, appNote }: ProjectBannerProps) {
  return (
    <>
      <Card>
        <div className={s.hero}>
          <span className="mdpp-row">
            <Chip tone="accent">{config.name}</Chip>
            <span className="mdpp-muted mdpp-sm">{config.fullName}</span>
          </span>
          <h1>{config.tagline}</h1>
          <p className={s.desc}>{config.description}</p>
          {appNote && <p className={s.appNote}>{appNote}</p>}
        </div>
      </Card>

      <div className={s.grid3}>
        {config.services.map((svc) => (
          <Card key={svc.key}>
            <CardBody className={s.service}>
              <div className={s.serviceHead}>
                <strong>{svc.name}</strong>
                {svc.key === currentService && <Chip tone="ok" dot>you are here</Chip>}
              </div>
              <span className={s.serviceRole}>{svc.role}</span>
              <p className="mdpp-sm mdpp-text-2">{svc.description}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className={s.grid2}>
        <Card>
          <CardHeader title="Consortium partners" />
          <CardBody className={s.list}>
            {config.partners.map((p) => (
              <div key={p.name} className={s.li}>
                <span>{p.name}</span>
                <span className={s.liSub}>{p.role}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Standards referenced" />
          <CardBody className={s.list}>
            {config.standards.map((st) => (
              <div key={st.name} className={s.li}>
                <a href={st.url} target="_blank" rel="noreferrer">{st.name}</a>
                <span className={s.liSub}>{st.detail}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Funding" />
          <CardBody className={s.list}>
            <p>{config.funding.text}</p>
            {config.funding.note && <span className={s.note}>{config.funding.note}</span>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contact" />
          <CardBody className={s.list}>
            <p>{config.contact.text}</p>
            {config.contact.people.map((c) => (
              <div key={c.email} className={s.li}>
                <span>{c.name}</span>
                <a className={s.liSub} href={`mailto:${c.email}`}>{c.email}</a>
              </div>
            ))}
            {config.contact.note && <span className={s.note}>{config.contact.note}</span>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contributors" subtitle={`${config.contributors.length}`} />
          <CardBody className={s.list}>
            {config.contributors.map((c) => (
              <div key={c.name} className={s.li}>
                <span className="mdpp-row" style={{ gap: 6 }}>
                  <span>{c.name}</span>
                  {c.email && <a className={s.liSub} href={`mailto:${c.email}`}>{c.email}</a>}
                </span>
                <span className={s.liSub}>{c.role}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Documentation & API" />
          <CardBody className={[s.list, s.links].join(" ")}>
            {config.links.map((l) => (
              <div key={l.href} className={s.li}>
                <a href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{l.label}</a>
                {l.description && <span className={s.liSub}>{l.description}</span>}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
