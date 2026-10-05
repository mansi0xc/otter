// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {OtterOrderBook} from "../src/OtterOrderBook.sol";
import {OtterRewardLedger} from "../src/OtterRewardLedger.sol";
import {IOtterLiquidityGuard} from "../src/interfaces/IOtterLiquidityGuard.sol";
import {AssetToken, RejectingAssetReceiver} from "./OtterAssets.t.sol";

/// @dev Ledger-only fault-injection state. This is not a pool authenticator.
/// Real opening ownership/weights/exits are tested in OtterHistoricalRewards.
contract RewardBookStub {
    mapping(bytes32 => bool) public executionInProgress;
    mapping(bytes32 => uint256) public currentBatchId;
    mapping(bytes32 => mapping(uint256 => bool)) public payoutsCredited;
    mapping(bytes32 => mapping(uint256 => bytes32)) public snapshotHash;
    mapping(bytes32 => bytes32) public rewardPolicyHashOf;
    mapping(bytes32 => address) public currency0Of;
    mapping(bytes32 => address) public currency1Of;
    mapping(bytes32 => mapping(uint256 => uint256)) public openingRewardWeight;
    mapping(bytes32 => IOtterLiquidityGuard.PositionSnapshot[]) private positions;
    mapping(bytes32 => uint256[]) private weights;

    function setup(bytes32 id, address currency, bytes32 policy) external {
        currency1Of[id] = currency;
        rewardPolicyHashOf[id] = policy;
        executionInProgress[id] = true;
        payoutsCredited[id][0] = true;
        snapshotHash[id][0] = bytes32(uint256(1));
        delete positions[id];
        delete weights[id];
        positions[id].push(IOtterLiquidityGuard.PositionSnapshot(1, address(0xA1), -60, 60, 1));
        positions[id].push(IOtterLiquidityGuard.PositionSnapshot(2, address(0xB1), -60, 60, 2));
        weights[id].push(1);
        weights[id].push(2);
        openingRewardWeight[id][0] = 3;
    }

    function setTotal(bytes32 id, uint256 total) external {
        openingRewardWeight[id][0] = total;
    }

    function setExecuting(bytes32 id, bool value) external {
        executionInProgress[id] = value;
    }

    function setPayouts(bytes32 id, bool value) external {
        payoutsCredited[id][0] = value;
    }

    function openingPositions(bytes32 id, uint256)
        external
        view
        returns (IOtterLiquidityGuard.PositionSnapshot[] memory)
    {
        return positions[id];
    }

    function openingRewardWeights(bytes32 id, uint256) external view returns (uint256[] memory) {
        return weights[id];
    }
}

contract RewardCallbackToken is MockERC20 {
    OtterRewardLedger private ledger;
    bytes4 public rejectedWith;
    constructor() MockERC20("Reward callback", "RCB", 18) {}

    function arm(OtterRewardLedger target) external {
        ledger = target;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool result = super.transferFrom(from, to, amount);
        if (to == address(ledger)) {
            (bool ok, bytes memory reason) =
                address(ledger).call(abi.encodeCall(OtterRewardLedger.claim, (address(this), 1, address(0xCAFE))));
            require(!ok && reason.length >= 4, "callback was not rejected");
            rejectedWith = bytes4(reason);
        }
        return result;
    }
}

contract RewardNativeCallbackReceiver {
    OtterRewardLedger private immutable ledger;
    bytes4 public rejectedWith;

    constructor(OtterRewardLedger target) {
        ledger = target;
    }

    receive() external payable {
        (bool ok, bytes memory reason) =
            address(ledger).call(abi.encodeCall(OtterRewardLedger.claim, (address(0), 1, address(this))));
        require(!ok && reason.length >= 4, "native callback was not rejected");
        rejectedWith = bytes4(reason);
    }
}

contract OtterRewardLedgerTest is Test {
    RewardBookStub stub;
    OtterRewardLedger ledger;
    AssetToken token;
    bytes32 constant POOL = bytes32(uint256(1));
    bytes32 constant OTHER = bytes32(uint256(2));
    address constant ALICE = address(0xA1);
    address constant BOB = address(0xB1);
    address constant COMMUNITY = address(0xD057);

    function setUp() public {
        stub = new RewardBookStub();
        ledger = new OtterRewardLedger(OtterOrderBook(address(stub)));
        token = new AssetToken();
        token.mint(address(this), 1e30);
        token.approve(address(ledger), type(uint256).max);
        stub.setup(POOL, address(token), ledger.registerPool(POOL, COMMUNITY));
        stub.setup(OTHER, address(token), ledger.registerPool(OTHER, COMMUNITY));
        vm.deal(address(this), 1e30);
    }

    function test_bothCurrencyPotsAndExactDustAreIndependentlyBacked() public {
        ledger.creditEpoch{value: 100}(POOL, 0, 100, 101);
        assertEq(ledger.claimable(ALICE, address(0)), 33);
        assertEq(ledger.claimable(BOB, address(0)), 66);
        assertEq(ledger.claimable(COMMUNITY, address(0)), 1);
        assertEq(ledger.claimable(ALICE, address(token)), 33);
        assertEq(ledger.claimable(BOB, address(token)), 67);
        assertEq(ledger.claimable(COMMUNITY, address(token)), 1);
        assertEq(ledger.epochDust(POOL, 0, address(0)), 1);
        assertEq(ledger.totalClaimable(address(0)), 100);
        assertEq(ledger.totalClaimable(address(token)), 101);
    }

    function test_sharedTokenPoolsCannotSpendEachOthersRewardCash() public {
        ledger.creditEpoch(POOL, 0, 0, 101);
        ledger.creditEpoch(OTHER, 0, 0, 202);
        uint256 alice = ledger.claimable(ALICE, address(token));
        vm.prank(ALICE);
        ledger.claim(address(token), alice, address(0xCAFE));
        assertEq(token.balanceOf(address(ledger)), 303 - alice);
        assertEq(token.balanceOf(address(ledger)), ledger.totalClaimable(address(token)));
        uint256 bob = ledger.claimable(BOB, address(token));
        uint256 community = ledger.claimable(COMMUNITY, address(token));
        vm.prank(BOB);
        ledger.claim(address(token), bob, address(0xBEEF));
        vm.prank(COMMUNITY);
        ledger.claim(address(token), community, COMMUNITY);
        assertEq(ledger.totalClaimable(address(token)), 0);
        assertEq(token.balanceOf(address(ledger)), 0);
    }

    function test_rejectingNativeReceiverRollsBackOnlyItsOwnClaim() public {
        ledger.creditEpoch{value: 100}(POOL, 0, 100, 101);
        address rejector = address(new RejectingAssetReceiver());
        vm.prank(ALICE);
        vm.expectRevert(OtterRewardLedger.NativeTransferFailed.selector);
        ledger.claim(address(0), 33, rejector);
        assertEq(ledger.claimable(ALICE, address(0)), 33);
        assertEq(ledger.totalClaimable(address(0)), 100);
        vm.prank(BOB);
        ledger.claim(address(0), 66, address(0xCAFE));
        vm.prank(ALICE);
        ledger.claim(address(token), 33, address(0xBEEF));
        vm.prank(ALICE);
        ledger.claim(address(0), 33, address(0xBEEF));
        assertEq(address(ledger).balance, ledger.totalClaimable(address(0)));
    }

    function test_taxedRewardPullRollsBackFundingCreditsAndEpochFlag() public {
        token.configureSenderFee(true);
        vm.expectRevert(abi.encodeWithSelector(OtterRewardLedger.InexactTransfer.selector, address(token), 101));
        ledger.creditEpoch(POOL, 0, 0, 101);
        assertFalse(ledger.credited(POOL, 0));
        assertEq(token.balanceOf(address(ledger)), 0);
        token.configureSenderFee(false);
        token.configure(false, false, true);
        vm.expectRevert(abi.encodeWithSelector(OtterRewardLedger.InexactTransfer.selector, address(token), 101));
        ledger.creditEpoch(POOL, 0, 0, 101);
        assertEq(ledger.totalClaimable(address(token)), 0);
        token.configure(true, false, false);
        ledger.creditEpoch(POOL, 0, 0, 101);
        assertEq(ledger.totalClaimable(address(token)), 101);
    }

    function test_lateTaxOrFalseReturnCannotConsumeOtherOwnersBacking() public {
        ledger.creditEpoch(POOL, 0, 0, 101);
        token.mint(address(ledger), 1); // permit sender surcharge to run, then detect it
        token.configureSenderFee(true);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(OtterRewardLedger.InexactTransfer.selector, address(token), 33));
        ledger.claim(address(token), 33, address(0xCAFE));
        token.configureSenderFee(false);
        token.configure(false, false, true);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(OtterRewardLedger.InexactTransfer.selector, address(token), 33));
        ledger.claim(address(token), 33, address(0xCAFE));
        token.configure(false, true, false);
        vm.prank(ALICE);
        vm.expectRevert();
        ledger.claim(address(token), 33, address(0xCAFE));
        assertEq(ledger.claimable(ALICE, address(token)), 33);
        assertEq(ledger.totalClaimable(address(token)), 101);
        assertEq(token.balanceOf(address(ledger)), 102);
        token.configure(true, false, false);
        vm.prank(BOB);
        ledger.claim(address(token), 67, address(0xBEEF));
    }

    function test_invalidWeightsRollBackCashTransferAndNativeValue() public {
        stub.setTotal(POOL, 4);
        vm.expectRevert(OtterRewardLedger.InvalidWeights.selector);
        ledger.creditEpoch{value: 100}(POOL, 0, 100, 101);
        assertFalse(ledger.credited(POOL, 0));
        assertEq(address(ledger).balance, 0);
        assertEq(token.balanceOf(address(ledger)), 0);
        assertEq(ledger.totalClaimable(address(token)), 0);
        stub.setTotal(POOL, 0);
        vm.expectRevert(OtterRewardLedger.InvalidWeights.selector);
        ledger.creditEpoch(POOL, 0, 0, 0);
    }

    function test_wrongNativeValueOrEpochStateRejectsBeforeCredit() public {
        vm.expectRevert(abi.encodeWithSelector(OtterRewardLedger.InexactTransfer.selector, address(0), 100));
        ledger.creditEpoch{value: 99}(POOL, 0, 100, 101);
        stub.setExecuting(POOL, false);
        vm.expectRevert(OtterRewardLedger.InvalidEpoch.selector);
        ledger.creditEpoch(POOL, 0, 0, 0);
        stub.setExecuting(POOL, true);
        stub.setPayouts(POOL, false);
        vm.expectRevert(OtterRewardLedger.InvalidEpoch.selector);
        ledger.creditEpoch(POOL, 0, 0, 0);
        stub.setPayouts(POOL, true);
        vm.expectRevert(OtterRewardLedger.InvalidEpoch.selector);
        ledger.creditEpoch(POOL, 1, 0, 0);
        ledger.creditEpoch(POOL, 0, 0, 0);
        assertTrue(ledger.credited(POOL, 0));
        vm.expectRevert(OtterRewardLedger.AlreadyCredited.selector);
        ledger.creditEpoch(POOL, 0, 0, 0);
    }

    function test_outsiderCannotConfigureFundOrClaimAndUnsolicitedCashCreatesNoCredit() public {
        vm.prank(ALICE);
        vm.expectRevert(OtterRewardLedger.NotSettlement.selector);
        ledger.registerPool(bytes32(uint256(3)), ALICE);
        vm.prank(ALICE);
        vm.expectRevert(OtterRewardLedger.NotSettlement.selector);
        ledger.creditEpoch(POOL, 0, 0, 0);
        token.mint(address(ledger), 1000);
        vm.prank(ALICE);
        vm.expectRevert(OtterRewardLedger.InvalidClaim.selector);
        ledger.claim(address(token), 1, ALICE);
        assertEq(ledger.totalClaimable(address(token)), 0);
        vm.expectRevert(OtterRewardLedger.InvalidPolicy.selector);
        ledger.registerPool(bytes32(uint256(3)), address(0));
    }

    function test_existingInsolvencyCannotBeMaskedByAnotherPoolsNewPot() public {
        ledger.creditEpoch(POOL, 0, 0, 101);
        deal(address(token), address(ledger), 100); // explicit backing fault, not supported token behavior
        vm.expectRevert(abi.encodeWithSelector(OtterRewardLedger.Insolvent.selector, address(token)));
        ledger.creditEpoch(OTHER, 0, 0, 202);
        assertFalse(ledger.credited(OTHER, 0));
        assertEq(ledger.totalClaimable(address(token)), 101);
    }

    function test_tokenCallbackCannotReenterRewardDeliveryDuringFunding() public {
        RewardCallbackToken callback = new RewardCallbackToken();
        stub.setup(POOL, address(callback), ledger.policyHashOf(POOL));
        callback.arm(ledger);
        callback.mint(address(this), 101);
        callback.approve(address(ledger), 101);
        ledger.creditEpoch(POOL, 0, 0, 101);
        assertEq(callback.rejectedWith(), OtterRewardLedger.ReentrantCall.selector);
        assertEq(callback.balanceOf(address(ledger)), 101);
    }

    function test_nativeClaimCallbackCannotReenterOrSpendOtherOwnersBacking() public {
        ledger.creditEpoch{value: 100}(POOL, 0, 100, 0);
        RewardNativeCallbackReceiver receiver = new RewardNativeCallbackReceiver(ledger);
        vm.prank(ALICE);
        ledger.claim(address(0), 33, address(receiver));
        assertEq(receiver.rejectedWith(), OtterRewardLedger.ReentrantCall.selector);
        assertEq(address(receiver).balance, 33);
        assertEq(ledger.claimable(ALICE, address(0)), 0);
        assertEq(ledger.claimable(BOB, address(0)), 66);
        assertEq(address(ledger).balance, ledger.totalClaimable(address(0)));
    }
}
