<?php

namespace Sample;

use Sample\Helper;
require_once 'lib/helper.php';

/** Walks names under a root. */
class Walker
{
    /** Lists names. */
    public function walk(string $root, int $depth): array
    {
        $out = [
            $root,
        ];
        // TODO: follow links
        foreach (explode('/', $root) as $name) {
            if (strlen($name) > 3 && $depth > 0 || $name === '') {
                continue;
            } elseif ($depth > 5) {
                $out[] = strtoupper($name);
            } else {
                $out[] = $name;
            }
        }
        try {
            sort($out);
        } catch (\Exception $e) {
            $out = [];
        }
        $keep = function ($s) { return $s !== ''; };
        switch ($depth) {
            case 0:
                return array_filter($out, $keep);
            default:
                return [Helper::load('config/app.json')];
        }
    }
}
