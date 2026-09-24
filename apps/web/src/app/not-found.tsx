import Link from "next/link";
import { CanalisLogo } from "../components/brand/canalis-logo";

export default function NotFound() { return <main className="not-found-page"><CanalisLogo /><span>404</span><h1>That route is not part of this workspace.</h1><p>Return to the Canalis dashboard or open the reference task.</p><div><Link className="primary-action" href="/dashboard">Dashboard</Link><Link className="secondary-action" href="/tasks/demo">Reference task</Link></div></main>; }
