# Lessons

- Automatic layout must use the authored reading direction: top-left to bottom-right
  in screen space. Test equal-rank and cyclic groups, not only acyclic dependencies.
- Keep instructional legends out of the canvas; the user prefers an uncluttered map.
- Start in the authored layout. Verify actual geometry when testing layout switches,
  including cached round trips; a dropdown value alone does not prove the view changed.
