"use client";

export default function ProductError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div className="error-page"><span>!</span><h1>Something interrupted this view.</h1><p>The product shell is still available. Retry this page without losing your place.</p><button className="primary-action" type="button" onClick={reset}>Retry page</button></div>; }
