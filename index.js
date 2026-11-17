/**
 * The repository root as a dsh bundle.
 *
 * A bundle contributes a patch layer rather than a plugin row, so there is
 * nothing to apply here: the composition lives in `cordis.patch.yml`, which the
 * manifest points at through `dsh.bundle.patch`. The export exists so the
 * package is a loadable module like every other dsh package.
 */

export function apply() {}
