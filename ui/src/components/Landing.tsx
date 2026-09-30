/**
 * {@link Landing}'s props: what Browse does, and any message about files that couldn't be
 * opened.
 */
type LandingProps = { onBrowse: () => void; problem?: string };

/**
 * Renders the window with nothing open: a large drop zone and a Browse button.
 *
 * @param props - What Browse does, and the message.
 */
function Landing({ onBrowse, problem }: LandingProps) {
  return (
    <section className="landing" aria-label="Open images">
      <h2>Drop images here</h2>
      <p className="muted">PNG, JPEG, WebP, AVIF or SVG</p>
      <button type="button" className="primary" onClick={onBrowse}>
        Browse
      </button>
      {problem !== undefined && (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

export default Landing;
export type { LandingProps };
