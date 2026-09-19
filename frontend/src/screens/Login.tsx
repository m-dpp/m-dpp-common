import { ReactNode } from "react";
import { Button } from "../design/Button";
import { Card } from "../design/Card";
import { Notice } from "../design/Notice";
import s from "./Login.module.css";

export type SignInMethod = "sso" | "email";

export interface LoginProps {
  productName: ReactNode;
  tagline?: ReactNode;
  mark?: ReactNode;
  /** Called with the chosen method. There is no real authentication behind this yet. */
  onSignIn: (method: SignInMethod) => void;
  note?: ReactNode;
}

export function Login({ productName, tagline, mark, onSignIn, note }: LoginProps) {
  return (
    <div className={s.page}>
      <Card className={s.card}>
        <div className={s.brand}>
          <div className={s.mark}>{mark ?? "DP"}</div>
          <h1>{productName}</h1>
          {tagline && <div className={s.tagline}>{tagline}</div>}
        </div>
        <div className={s.actions}>
          <Button variant="primary" size="lg" block onClick={() => onSignIn("sso")}>
            Continue with SSO
          </Button>
          <div className={s.or}>or</div>
          <Button size="lg" block onClick={() => onSignIn("email")}>
            Continue with email
          </Button>
        </div>
        <Notice tone="dev">
          {note ?? (
            <span>
              <strong>Authentication is a placeholder.</strong> Signing in does not verify an identity yet. Inside, use the <em>acting as</em> switcher to choose which subject you represent.
            </span>
          )}
        </Notice>
      </Card>
    </div>
  );
}
