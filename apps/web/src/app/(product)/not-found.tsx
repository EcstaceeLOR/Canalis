import Link from "next/link";

export default function ProductNotFound() {
  return (
    <section className="error-page" aria-labelledby="not-found-title">
      <span aria-hidden="true">404</span>
      <h1 id="not-found-title">This workspace record is not available.</h1>
      <p>It may have been removed, belong to another wallet, or the link may be incomplete. Your current workspace is unchanged.</p>
      <div className="page-actions">
        <Link className="primary-action" href="/dashboard">Back to dashboard</Link>
        <Link className="secondary-action" href="/tasks">Open tasks</Link>
      </div>
    </section>
  );
}
