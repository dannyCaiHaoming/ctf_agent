import { randomUUID } from 'node:crypto';
import { PublishedOutputInputSchema, type DependencyVersion, type PublishedOutputInput } from '@ctf/contracts';
import { freezeData, type DeepReadonly, type VerifyArtifact } from './responsibilities.js';

export interface PublishedOutput extends PublishedOutputInput { publication_id: string; revision: number }
export interface AdoptedOutput extends PublishedOutput { valid: boolean }
export interface AdoptionResult { current: DeepReadonly<AdoptedOutput>; invalidated_output_ids: readonly string[] }

/**
 * Tracks only immutable, explicitly adopted outputs. Workspace writes and mere
 * publication cannot invalidate anything. Scope one instance to one run/challenge.
 */
export class PublishedRevisionService {
  private readonly publications = new Map<string, DeepReadonly<PublishedOutput>>();
  private readonly adopted = new Map<string, DeepReadonly<AdoptedOutput>>();
  private readonly nextRevision = new Map<string, number>();

  constructor(private readonly options: { verifyArtifact: VerifyArtifact }) {}

  async publish(input: unknown): Promise<DeepReadonly<PublishedOutput>> {
    const parsed = freezeData(PublishedOutputInputSchema.parse(input));
    if (await this.options.verifyArtifact(parsed.artifact) !== true) throw new Error('immutable artifact verification failed');
    const revision = this.nextRevision.get(parsed.output_id) ?? 0;
    this.nextRevision.set(parsed.output_id, revision + 1);
    const publication = freezeData({ ...parsed, publication_id: `publication_${randomUUID()}`, revision });
    this.publications.set(publication.publication_id, publication);
    return publication;
  }

  adopt(publicationId: string): AdoptionResult {
    const publication = this.publications.get(publicationId);
    if (!publication) throw new Error('unknown publication');
    for (const dependency of publication.dependency_versions) {
      const current = this.adopted.get(dependency.output_id);
      if (!current?.valid || current.revision !== dependency.revision) throw new Error('dependency is not the current valid adopted revision');
      if (dependency.output_id === publication.output_id || this.dependsOn(dependency.output_id, publication.output_id)) throw new Error('dependency cycle');
    }
    const previous = this.adopted.get(publication.output_id);
    // Same immutable bytes and dependencies retain the original adopted revision.
    if (previous?.valid && previous.artifact.hash === publication.artifact.hash && previous.artifact.size === publication.artifact.size &&
      dependencyKey(previous.dependency_versions) === dependencyKey(publication.dependency_versions)) {
      return freezeData({ current: previous, invalidated_output_ids: [] });
    }
    // An old publication must never roll an output back over a newer adoption.
    if (previous && publication.revision <= previous.revision) throw new Error('publication revision is not newer than adopted revision');
    const invalidated = new Set<string>();
    if (previous) this.invalidateDependents(previous.output_id, previous.revision, invalidated);
    const current = freezeData({ ...publication, valid: true });
    this.adopted.set(publication.output_id, current);
    return freezeData({ current, invalidated_output_ids: [...invalidated].sort() });
  }

  current(outputId: string): DeepReadonly<AdoptedOutput> | undefined { return this.adopted.get(outputId); }

  private invalidateDependents(outputId: string, revision: number, invalidated: Set<string>): void {
    for (const dependent of this.adopted.values()) {
      if (invalidated.has(dependent.output_id) || !dependent.dependency_versions.some(dep => dep.output_id === outputId && dep.revision === revision)) continue;
      invalidated.add(dependent.output_id);
      this.adopted.set(dependent.output_id, freezeData({ ...dependent, valid: false }));
      this.invalidateDependents(dependent.output_id, dependent.revision, invalidated);
    }
  }

  private dependsOn(outputId: string, target: string, visited = new Set<string>()): boolean {
    if (visited.has(outputId)) return false;
    visited.add(outputId);
    return this.adopted.get(outputId)?.dependency_versions.some(dep => dep.output_id === target || this.dependsOn(dep.output_id, target, visited)) ?? false;
  }
}

function dependencyKey(dependencies: readonly DeepReadonly<DependencyVersion>[]): string {
  return JSON.stringify([...dependencies].sort((a, b) => a.output_id.localeCompare(b.output_id)));
}
