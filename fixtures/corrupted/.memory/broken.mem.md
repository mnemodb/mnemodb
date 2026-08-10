---
mnemo: "0.1"
scope: project
title: "corrupted fixture — every doctor rule should fire"
---

<<<<<<< HEAD
conflicted preamble line
=======
other side
>>>>>>> branch

## fact: duplicate id first
`mnemo dup1`

## fact: duplicate id second
`mnemo dup1`

## fact: bad id in metadata
`mnemo THIS IS NOT VALID`

## fact: unterminated metadata line
`mnemo trunc8 | src: agent

## decision: supersedes something that does not exist
`mnemo orp1 | supersedes: zzzz`

## decision: contradiction A
`mnemo con1 | supersedes: dup1`

## decision: contradiction B
`mnemo con2 | supersedes: dup1`
