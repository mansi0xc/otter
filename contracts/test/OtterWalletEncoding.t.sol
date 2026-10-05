// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";

/// Cross-check the actual browser helper's typed data and signatures against the book.
/// No RPC, real wallet, deployment script or production source is changed.
contract OtterWalletEncodingTest is Test {
    OtterOrderBook book;

    function setUp() public { book = new OtterOrderBook(60, 300); }

    function testFuzzBrowserV2DigestAndSignature(
        uint96 budget, uint128 ask, uint256 nonce, uint64 deadline, uint64 execution, uint256 epoch
    ) public {
        _check(OtterOrderBook.Order(vm.addr(0xA11CE), bytes32(uint256(51)), true, ask, budget,
            deadline, nonce, 1, epoch, execution));
    }

    function testBrowserV2ReverseAndMaximumFields() public {
        _check(OtterOrderBook.Order(vm.addr(0xA11CE), bytes32(type(uint256).max), false,
            type(uint128).max, type(uint96).max, type(uint64).max, type(uint256).max,
            type(uint256).max, type(uint256).max, type(uint64).max));
    }

    function _check(OtterOrderBook.Order memory order) private {
        string[] memory command = new string[](6);
        command[0] = "node";
        command[1] = "--experimental-strip-types";
        command[2] = "../web/test/hash-order.ts";
        command[3] = vm.toString(block.chainid);
        command[4] = vm.toString(address(book));
        command[5] = vm.toString(abi.encode(order));
        (bytes32 structHash, bytes32 digest, bytes memory signature) = abi.decode(vm.ffi(command), (bytes32, bytes32, bytes));
        assertEq(structHash, book.hashOrder(order));
        assertEq(digest, book.digestOf(order));
        assertEq(signature.length, 65);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        assertLe(uint256(s), book.MAX_S());
        assertEq(ecrecover(digest, v, r, s), order.trader);
    }
}
