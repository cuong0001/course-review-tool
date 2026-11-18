/* Course-scoped wrapper over ReviewCore for isolated OOP / CN previews. */
(function (root) {
  'use strict';
  const Core = root.ReviewCore || (typeof require !== 'undefined' ? require('./review-core.js') : null);
  if (!Core) throw Error('ReviewCore must be loaded before CourseReviewCore.');

  function validateCoursePackage(pkg, expectedCourseId) {
    if (!pkg || pkg.format !== 'course-review-package' || pkg.version !== 2) {
      throw Error('Invalid or unsupported review package (expected course-review-package v2 with matching course_id).');
    }
    if (typeof pkg.course_id !== 'string' || pkg.course_id !== expectedCourseId) {
      throw Error(`Course mismatch: package belongs to '${pkg.course_id || 'unknown'}', expected '${expectedCourseId}'.`);
    }
    // Delegate item-level validation to ReviewCore by mapping to v1 shape temporarily
    Core.validatePackage({ ...pkg, version: 1 });
    return pkg;
  }

  function exportCoursePackage(reviewer, workspace, courseId, snapshotMeta = {}) {
    return {
      format: 'course-review-package',
      version: 2,
      course_id: courseId,
      dataset_version: snapshotMeta.dataset_version || null,
      reviewer,
      exported_at: new Date().toISOString(),
      position: workspace.position || '',
      items: Object.entries(workspace.states || {})
        .filter(([, s]) => s.fingerprint)
        .map(([k, s]) => ({
          item_type: k.split(':')[0],
          id: k.slice(k.indexOf(':') + 1),
          state: s,
        })),
    };
  }

  function courseDecisions(reviewer, states, loaded, courseId) {
    const base = Core.decisions(reviewer, states, loaded);
    return { ...base, version: 2, course_id: courseId };
  }

  root.CourseReviewCore = {
    ...Core,
    validateCoursePackage,
    exportCoursePackage,
    courseDecisions,
  };
  if (typeof module !== 'undefined') module.exports = root.CourseReviewCore;
})(globalThis);
