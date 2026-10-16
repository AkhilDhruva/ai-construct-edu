import { Suspense, useCallback, useState } from 'react'
import { Link, useParams } from 'react-router'
import { LAB_COMPONENTS } from '../labs'
import type { LabEvidence } from '../labs/types'
import { useMantle } from '../state/useMantle'
import { TutorPanel } from '../ui/TutorPanel'
import { usePackage } from './usePackage'

export function Lab() {
  const pkg = usePackage()
  const { lab: labId } = useParams()
  const run = useMantle((s) => s.run)
  const lab = pkg?.labs.find((l) => l.ref.id === labId)
  const concepts = lab?.ref.concepts
  const [lastEvidence, setLastEvidence] = useState<LabEvidence | undefined>()

  const onEvidence = useCallback(
    async (e: LabEvidence) => {
      if (!concepts) return
      setLastEvidence(e)
      await run((rt) =>
        rt.recordAttempt({ kind: 'lab', itemId: e.itemId, conceptIds: concepts, tier: 'apply', depth: e.depth, correct: e.correct, answer: e.answer, latencyMs: e.latencyMs }),
      )
    },
    [run, concepts],
  )

  if (!pkg || !lab) return <p>Unknown lab.</p>
  const Engine = LAB_COMPONENTS[lab.ref.engine]
  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Plan</Link> / <Link to={pkg.manifest.route}>{pkg.manifest.title}</Link> / {lab.ref.title}
      </nav>
      <div>
        <div className="eyebrow">Lab · engine: {lab.ref.engine}</div>
        <h1>{lab.ref.title}</h1>
      </div>
      <div className="card">
        <Suspense fallback={<p role="status">Loading lab…</p>}>
          <Engine labRef={lab.ref} scenario={lab.scenario} onEvidence={onEvidence} />
        </Suspense>
      </div>
      <TutorPanel conceptId={lab.ref.concepts[0]} labId={lab.ref.id} labState={lastEvidence && { item: lastEvidence.itemId, correct: lastEvidence.correct, answer: lastEvidence.answer }} />
      <p className="small">
        Then:{' '}
        {lab.ref.concepts.map((c, i) => (
          <span key={c}>
            {i > 0 && ' · '}
            <Link to={`${pkg.manifest.route}/c/${c}`}>quick check on {pkg.concepts.find((x) => x.id === c)?.title}</Link>
          </span>
        ))}
      </p>
    </div>
  )
}
