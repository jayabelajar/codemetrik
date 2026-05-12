<?php

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use PhpParser\Node;
use PhpParser\Node\Expr;
use PhpParser\Node\Stmt;
use PhpParser\ParserFactory;

if ($argc < 2) {
    fwrite(STDERR, "Usage: php_metrics.php <file>\n");
    exit(1);
}

$path = $argv[1];
if (!is_file($path)) {
    fwrite(STDERR, "File not found: {$path}\n");
    exit(1);
}

$code = file_get_contents($path);
if ($code === false) {
    fwrite(STDERR, "Unable to read file: {$path}\n");
    exit(1);
}

function isFunctionLike(Node $node): bool {
    return $node instanceof Stmt\Function_
        || $node instanceof Stmt\ClassMethod
        || $node instanceof Expr\Closure
        || $node instanceof Expr\ArrowFunction;
}

function shortClassName(Node $node): string {
    $parts = explode('\\\\', $node::class);
    return end($parts) ?: 'Node';
}

function countDecisionNodes(Node $node): int {
    $count = 0;
    if ($node instanceof Stmt\If_) {
        $count += 1 + count($node->elseifs);
    } elseif ($node instanceof Stmt\For_
        || $node instanceof Stmt\Foreach_
        || $node instanceof Stmt\While_
        || $node instanceof Stmt\Do_
    ) {
        $count += 1;
    } elseif ($node instanceof Stmt\TryCatch) {
        $count += count($node->catches);
    } elseif ($node instanceof Stmt\Switch_) {
        $nonDefaultCases = 0;
        foreach ($node->cases as $case) {
            if ($case->cond !== null) {
                $nonDefaultCases++;
            }
        }
        $count += max($nonDefaultCases, 1);
    } elseif ($node instanceof Expr\Match_) {
        $count += count($node->arms);
    } elseif ($node instanceof Expr\Ternary) {
        $count += 1;
    } elseif ($node instanceof Expr\BinaryOp\BooleanAnd
        || $node instanceof Expr\BinaryOp\BooleanOr
        || $node instanceof Expr\BinaryOp\LogicalAnd
        || $node instanceof Expr\BinaryOp\LogicalOr
        || $node instanceof Expr\BinaryOp\LogicalXor
        || $node instanceof Expr\BinaryOp\Coalesce
    ) {
        $count += 1;
    }

    foreach ($node->getSubNodeNames() as $subNodeName) {
        $subNode = $node->$subNodeName;
        if ($subNode instanceof Node) {
            if (isFunctionLike($subNode)) {
                continue;
            }
            $count += countDecisionNodes($subNode);
        } elseif (is_array($subNode)) {
            foreach ($subNode as $child) {
                if (!$child instanceof Node) {
                    continue;
                }
                if (isFunctionLike($child)) {
                    continue;
                }
                $count += countDecisionNodes($child);
            }
        }
    }

    return $count;
}

function cfg_new_node(array &$nodes, int &$counter, string $label): string {
    $id = 'n' . $counter;
    $counter++;
    $nodes[] = ['id' => $id, 'label' => $label];
    return $id;
}

function cfg_connect(array &$edges, array $fromIds, string $to, string $label = 'next'): void {
    foreach ($fromIds as $from) {
        $edges[] = ['from' => $from, 'to' => $to, 'label' => $label];
    }
}

function cfg_build_block(array $stmts, array $incoming, array &$nodes, array &$edges, int &$counter): array {
    $current = $incoming;
    foreach ($stmts as $stmt) {
        if (!$stmt instanceof Node) {
            continue;
        }
        $current = cfg_build_stmt($stmt, $current, $nodes, $edges, $counter);
    }
    return $current;
}

function cfg_build_if_chain(Stmt\If_ $stmt, array $incoming, array &$nodes, array &$edges, int &$counter): array {
    $cond = cfg_new_node($nodes, $counter, 'if');
    cfg_connect($edges, $incoming, $cond, 'next');

    $thenHub = cfg_new_node($nodes, $counter, 'then');
    cfg_connect($edges, [$cond], $thenHub, 'true');
    $exits = cfg_build_block($stmt->stmts, [$thenHub], $nodes, $edges, $counter);

    $remainingFalse = [$cond];
    foreach ($stmt->elseifs as $elseif) {
        $elifHub = cfg_new_node($nodes, $counter, 'elseif');
        cfg_connect($edges, $remainingFalse, $elifHub, 'false');

        $elifThenHub = cfg_new_node($nodes, $counter, 'then');
        cfg_connect($edges, [$elifHub], $elifThenHub, 'true');
        $elifExits = cfg_build_block($elseif->stmts, [$elifThenHub], $nodes, $edges, $counter);
        $exits = array_merge($exits, $elifExits);

        $remainingFalse = [$elifHub];
    }

    if ($stmt->else !== null) {
        $elseHub = cfg_new_node($nodes, $counter, 'else');
        cfg_connect($edges, $remainingFalse, $elseHub, 'false');
        $elseExits = cfg_build_block($stmt->else->stmts, [$elseHub], $nodes, $edges, $counter);
        $exits = array_merge($exits, $elseExits);
    } else {
        $exits = array_merge($exits, $remainingFalse);
    }

    $merge = cfg_new_node($nodes, $counter, 'merge_if');
    cfg_connect($edges, $exits, $merge, 'merge');
    return [$merge];
}

function cfg_build_switch(Stmt\Switch_ $stmt, array $incoming, array &$nodes, array &$edges, int &$counter): array {
    $sw = cfg_new_node($nodes, $counter, 'switch');
    cfg_connect($edges, $incoming, $sw, 'next');

    $caseExits = [];
    foreach ($stmt->cases as $idx => $case) {
        $label = $case->cond !== null ? "case_" . ($idx + 1) : 'default';
        $caseNode = cfg_new_node($nodes, $counter, $label);
        cfg_connect($edges, [$sw], $caseNode, $label);
        $exits = cfg_build_block($case->stmts, [$caseNode], $nodes, $edges, $counter);
        $caseExits = array_merge($caseExits, $exits);
    }

    if (count($stmt->cases) === 0) {
        $caseExits[] = $sw;
    }

    $merge = cfg_new_node($nodes, $counter, 'merge_switch');
    cfg_connect($edges, $caseExits, $merge, 'merge');
    return [$merge];
}

function cfg_build_loop(Node $stmt, array $incoming, array &$nodes, array &$edges, int &$counter, string $kind): array {
    $cond = cfg_new_node($nodes, $counter, $kind);
    cfg_connect($edges, $incoming, $cond, 'next');

    $bodyHub = cfg_new_node($nodes, $counter, 'loop_body');
    cfg_connect($edges, [$cond], $bodyHub, 'true');

    $bodyStmts = [];
    if ($stmt instanceof Stmt\For_ || $stmt instanceof Stmt\Foreach_ || $stmt instanceof Stmt\While_ || $stmt instanceof Stmt\Do_) {
        $bodyStmts = $stmt->stmts;
    }

    $bodyExits = cfg_build_block($bodyStmts, [$bodyHub], $nodes, $edges, $counter);
    cfg_connect($edges, $bodyExits, $cond, 'back');

    $after = cfg_new_node($nodes, $counter, 'after_loop');
    cfg_connect($edges, [$cond], $after, 'false');
    return [$after];
}

function cfg_build_trycatch(Stmt\TryCatch $stmt, array $incoming, array &$nodes, array &$edges, int &$counter): array {
    $tryNode = cfg_new_node($nodes, $counter, 'try');
    cfg_connect($edges, $incoming, $tryNode, 'next');

    $tryExits = cfg_build_block($stmt->stmts, [$tryNode], $nodes, $edges, $counter);
    $allExits = $tryExits;

    foreach ($stmt->catches as $idx => $catch) {
        $catchNode = cfg_new_node($nodes, $counter, 'catch_' . ($idx + 1));
        cfg_connect($edges, [$tryNode], $catchNode, 'catch');
        $catchExits = cfg_build_block($catch->stmts, [$catchNode], $nodes, $edges, $counter);
        $allExits = array_merge($allExits, $catchExits);
    }

    if ($stmt->finally !== null) {
        $finNode = cfg_new_node($nodes, $counter, 'finally');
        cfg_connect($edges, $allExits, $finNode, 'finally');
        $allExits = cfg_build_block($stmt->finally->stmts, [$finNode], $nodes, $edges, $counter);
    }

    $merge = cfg_new_node($nodes, $counter, 'merge_try');
    cfg_connect($edges, $allExits, $merge, 'merge');
    return [$merge];
}

function cfg_build_stmt(Node $stmt, array $incoming, array &$nodes, array &$edges, int &$counter): array {
    if ($stmt instanceof Stmt\If_) {
        return cfg_build_if_chain($stmt, $incoming, $nodes, $edges, $counter);
    }
    if ($stmt instanceof Stmt\Switch_) {
        return cfg_build_switch($stmt, $incoming, $nodes, $edges, $counter);
    }
    if ($stmt instanceof Stmt\For_) {
        return cfg_build_loop($stmt, $incoming, $nodes, $edges, $counter, 'for');
    }
    if ($stmt instanceof Stmt\Foreach_) {
        return cfg_build_loop($stmt, $incoming, $nodes, $edges, $counter, 'foreach');
    }
    if ($stmt instanceof Stmt\While_) {
        return cfg_build_loop($stmt, $incoming, $nodes, $edges, $counter, 'while');
    }
    if ($stmt instanceof Stmt\Do_) {
        return cfg_build_loop($stmt, $incoming, $nodes, $edges, $counter, 'do_while');
    }
    if ($stmt instanceof Stmt\TryCatch) {
        return cfg_build_trycatch($stmt, $incoming, $nodes, $edges, $counter);
    }

    $label = strtolower(shortClassName($stmt));
    $node = cfg_new_node($nodes, $counter, $label);
    cfg_connect($edges, $incoming, $node, 'next');
    return [$node];
}

function build_cfg_for_stmts(array $stmts): array {
    $nodes = [];
    $edges = [];
    $counter = 1;

    $start = cfg_new_node($nodes, $counter, 'start');
    $exits = cfg_build_block($stmts, [$start], $nodes, $edges, $counter);
    $end = cfg_new_node($nodes, $counter, 'end');
    cfg_connect($edges, $exits, $end, 'end');

    return ['nodes' => $nodes, 'edges' => $edges];
}

function build_function_metrics(array $nodes): array {
    $functions = [];
    foreach ($nodes as $node) {
        if (!$node instanceof Node) {
            continue;
        }
        if (isFunctionLike($node)) {
            $name = 'closure';
            if ($node instanceof Stmt\Function_ || $node instanceof Stmt\ClassMethod) {
                $name = $node->name->toString();
            } elseif ($node instanceof Expr\ArrowFunction) {
                $name = 'arrow_fn';
            }

            $stmts = $node instanceof Expr\ArrowFunction
                ? [new Stmt\Expression($node->expr)]
                : ($node->stmts ?? []);

            $cfg = build_cfg_for_stmts($stmts);
            $decisions = 0;
            foreach ($stmts as $stmt) {
                if ($stmt instanceof Node) {
                    $decisions += countDecisionNodes($stmt);
                }
            }
            $vg = 1 + $decisions;
            $edgeCount = count($cfg['edges']) + 1;
            $nodeCount = count($cfg['nodes']);

            $functions[] = [
                'name' => $name,
                'predicate_count' => max($vg - 1, 0),
                'vg' => $vg,
                'flowgraph' => [
                    'nodes' => $cfg['nodes'],
                    'edges' => $cfg['edges'],
                    'independent_paths' => $vg,
                ],
                'cyclomatic_detail' => [
                    'edge_count' => $edgeCount,
                    'node_count' => $nodeCount,
                    'connected_components' => 1,
                    'vg_formula' => $edgeCount - $nodeCount + 2,
                    'vg_predicate' => 1 + max($vg - 1, 0),
                ],
            ];
            continue;
        }

        foreach ($node->getSubNodeNames() as $subNodeName) {
            $subNode = $node->$subNodeName;
            if ($subNode instanceof Node) {
                $functions = array_merge($functions, build_function_metrics([$subNode]));
            } elseif (is_array($subNode)) {
                $functions = array_merge($functions, build_function_metrics($subNode));
            }
        }
    }
    return $functions;
}

$parser = (new ParserFactory())->createForNewestSupportedVersion();
try {
    $ast = $parser->parse($code);
} catch (Throwable $e) {
    fwrite(STDERR, "PHP AST parse failed: " . $e->getMessage() . "\n");
    exit(1);
}

$functions = build_function_metrics($ast ?? []);
$functionCount = count($functions);
if ($functionCount > 0) {
    $complexity = array_sum(array_map(fn($f) => (int)$f['vg'], $functions));
} else {
    $scriptDecisions = 0;
    foreach ($ast ?? [] as $node) {
        if ($node instanceof Node) {
            $scriptDecisions += countDecisionNodes($node);
        }
    }
    $complexity = trim($code) === '' ? 0 : (1 + $scriptDecisions);
}

$tokens = token_get_all($code, TOKEN_PARSE);
$operatorTokenIds = [
    T_IF, T_ELSEIF, T_ELSE, T_SWITCH, T_CASE, T_DEFAULT, T_MATCH,
    T_WHILE, T_DO, T_FOR, T_FOREACH, T_BREAK, T_CONTINUE,
    T_BOOLEAN_AND, T_BOOLEAN_OR, T_LOGICAL_AND, T_LOGICAL_OR, T_LOGICAL_XOR,
    T_COALESCE, T_INSTANCEOF, T_NEW, T_CLONE, T_THROW, T_TRY, T_CATCH, T_FINALLY,
    T_RETURN, T_YIELD, T_INCLUDE, T_INCLUDE_ONCE, T_REQUIRE, T_REQUIRE_ONCE,
    T_DOUBLE_ARROW, T_OBJECT_OPERATOR, T_PAAMAYIM_NEKUDOTAYIM,
    T_IS_EQUAL, T_IS_IDENTICAL, T_IS_NOT_EQUAL, T_IS_NOT_IDENTICAL, T_SPACESHIP,
    T_IS_SMALLER_OR_EQUAL, T_IS_GREATER_OR_EQUAL,
    T_PLUS_EQUAL, T_MINUS_EQUAL, T_MUL_EQUAL, T_DIV_EQUAL, T_MOD_EQUAL, T_CONCAT_EQUAL,
    T_AND_EQUAL, T_OR_EQUAL, T_XOR_EQUAL, T_SL_EQUAL, T_SR_EQUAL,
    T_INC, T_DEC, T_POW, T_POW_EQUAL, T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG,
    T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG, T_NULLSAFE_OBJECT_OPERATOR, T_FN,
];
$operatorSymbols = [
    '=', '+', '-', '*', '/', '%', '.', '!', '~', '&', '|', '^',
    '<', '>', '?', ':', '@', '&&', '||', '??', '=>', '->', '::',
    '==', '===', '!=', '!==', '<=', '>=', '<=>', '<<', '>>',
    '+=', '-=', '*=', '/=', '%=', '.=', '&=', '|=', '^=', '<<=', '>>=',
    '++', '--', '(', ')', '[', ']', '{', '}', ',', ';',
];
$operandTokenIds = [
    T_VARIABLE, T_STRING, T_LNUMBER, T_DNUMBER, T_NUM_STRING,
    T_CONSTANT_ENCAPSED_STRING, T_ENCAPSED_AND_WHITESPACE,
];

$operators = [];
$operands = [];
$n1Total = 0;
$n2Total = 0;
foreach ($tokens as $tok) {
    if (is_array($tok)) {
        [$id, $text] = $tok;
        if (in_array($id, $operatorTokenIds, true)) {
            $operators[token_name($id)] = true;
            $n1Total++;
        }
        if (in_array($id, $operandTokenIds, true)) {
            $value = $id === T_STRING ? strtolower($text) : $text;
            $operands[$value] = true;
            $n2Total++;
        }
        continue;
    }

    if (in_array($tok, $operatorSymbols, true)) {
        $operators[$tok] = true;
        $n1Total++;
    }
}

$n1 = count($operators);
$n2 = count($operands);
$vocabulary = $n1 + $n2;
$length = $n1Total + $n2Total;

if ($vocabulary > 0 && $length > 0) {
    $volume = $length * log($vocabulary, 2);
    $difficulty = ($n1 / 2.0) * ($n2Total / max($n2, 1));
    $effort = $difficulty * $volume;
} else {
    $volume = 0.0;
    $difficulty = 0.0;
    $effort = 0.0;
}

$payload = [
    'complexity' => (int)$complexity,
    'function_count' => (int)$functionCount,
    'functions' => $functions,
    'halstead_n1' => (int)$n1,
    'halstead_n2' => (int)$n2,
    'halstead_N1' => (int)$n1Total,
    'halstead_N2' => (int)$n2Total,
    'halstead_length' => (int)$length,
    'halstead_vocabulary' => (int)$vocabulary,
    'halstead_volume' => round($volume, 2),
    'halstead_difficulty' => round($difficulty, 2),
    'halstead_effort' => round($effort, 2),
];

echo json_encode($payload, JSON_UNESCAPED_SLASHES);
