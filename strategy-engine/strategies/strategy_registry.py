"""
Strategy Registry

Provides dynamic loading and management of trading strategies.
Strategies are automatically discovered and registered from the strategies/ directory.
"""

import importlib
import os
import sys
from pathlib import Path
from typing import Dict, Type, List
from .base_strategy import BaseStrategy


class StrategyRegistry:
    """
    Registry for managing available trading strategies

    The registry automatically discovers and loads strategy classes from
    the strategies/ directory. It provides methods to instantiate strategies
    by name and list available strategies.

    Usage:
        registry = StrategyRegistry()
        registry.discover_strategies()

        # Get available strategies
        strategies = registry.list_strategies()

        # Create a strategy instance
        strategy = registry.create_strategy("ma_cross", strategy_id="test_1", params={})
    """

    def __init__(self):
        self._strategies: Dict[str, Type[BaseStrategy]] = {}
        self._strategy_dir = Path(__file__).parent.resolve()

    def register_strategy(self, strategy_class: Type[BaseStrategy]):
        """
        Manually register a strategy class

        Args:
            strategy_class: Strategy class that inherits from BaseStrategy

        Raises:
            ValueError: If strategy_name is not defined or already registered
        """
        if not hasattr(strategy_class, 'strategy_name') or strategy_class.strategy_name is None:
            raise ValueError(
                f"Strategy {strategy_class.__name__} must define 'strategy_name' class attribute"
            )

        name = strategy_class.strategy_name

        if name in self._strategies:
            print(f"⚠️  Strategy '{name}' already registered, overwriting...")

        self._strategies[name] = strategy_class
        print(f"✅ Registered strategy: {name} ({strategy_class.__name__})")

    def discover_strategies(self, strategy_dir: str = None):
        """
        Automatically discover and register all strategies in the strategies directory

        Looks for all Python files in strategies/ directory (except __init__.py and
        files starting with underscore or dot) and attempts to load strategy classes.

        Args:
            strategy_dir: Optional custom directory path (defaults to strategies/)
        """
        if strategy_dir:
            search_dir = Path(strategy_dir)
        else:
            search_dir = self._strategy_dir

        print(f"🔍 Discovering strategies in: {search_dir}")

        # Make sure the strategies directory is in the Python path
        if str(search_dir.parent) not in sys.path:
            sys.path.insert(0, str(search_dir.parent))

        # Find all Python files
        strategy_files = []
        for file_path in search_dir.glob("*.py"):
            # Skip special files
            if file_path.name.startswith(('_', '.')) or file_path.name == '__init__.py':
                continue
            # Skip base_strategy and strategy_registry
            if file_path.name in ('base_strategy.py', 'strategy_registry.py'):
                continue
            strategy_files.append(file_path)

        print(f"📁 Found {len(strategy_files)} strategy files")

        # Try to import each file
        for file_path in strategy_files:
            module_name = file_path.stem  # Filename without extension
            try:
                # Import the module
                module = importlib.import_module(f"strategies.{module_name}")

                # Look for BaseStrategy subclasses in the module
                for attr_name in dir(module):
                    attr = getattr(module, attr_name)

                    # Check if it's a class and inherits from BaseStrategy
                    if (isinstance(attr, type) and
                        issubclass(attr, BaseStrategy) and
                        attr is not BaseStrategy):

                        # Register it
                        try:
                            self.register_strategy(attr)
                        except ValueError as e:
                            print(f"⚠️  Skipping {attr_name}: {e}")

            except Exception as e:
                print(f"❌ Failed to load {module_name}: {e}")
                import traceback
                traceback.print_exc()

    def create_strategy(
        self,
        strategy_name: str,
        strategy_id: str,
        params: Dict = None
    ) -> BaseStrategy:
        """
        Create an instance of a registered strategy

        Args:
            strategy_name: Name of the strategy (e.g., 'ma_cross', 'rsi')
            strategy_id: Unique identifier for this strategy instance
            params: Strategy-specific parameters (optional)

        Returns:
            Initialized strategy instance

        Raises:
            ValueError: If strategy_name is not registered
        """
        if strategy_name not in self._strategies:
            available = ", ".join(self._strategies.keys())
            raise ValueError(
                f"Strategy '{strategy_name}' not found. "
                f"Available strategies: {available}"
            )

        strategy_class = self._strategies[strategy_name]
        strategy_instance = strategy_class()
        strategy_instance.initialize(strategy_id, params or {})

        return strategy_instance

    def list_strategies(self) -> List[Dict[str, any]]:
        """
        Get list of all registered strategies with their info

        Returns:
            List of dictionaries containing strategy information
        """
        strategies = []
        for name, strategy_class in self._strategies.items():
            strategies.append({
                "name": name,
                "class": strategy_class.__name__,
                "default_params": strategy_class.default_params,
                "description": strategy_class.__doc__.strip() if strategy_class.__doc__ else "No description"
            })
        return strategies

    def get_strategy_info(self, strategy_name: str) -> Dict[str, any]:
        """
        Get detailed information about a specific strategy

        Args:
            strategy_name: Name of the strategy

        Returns:
            Dictionary with strategy details

        Raises:
            ValueError: If strategy not found
        """
        if strategy_name not in self._strategies:
            raise ValueError(f"Strategy '{strategy_name}' not found")

        strategy_class = self._strategies[strategy_name]
        return {
            "name": strategy_name,
            "class": strategy_class.__name__,
            "default_params": strategy_class.default_params,
            "description": strategy_class.__doc__.strip() if strategy_class.__doc__ else "No description",
            "module": strategy_class.__module__
        }

    def is_registered(self, strategy_name: str) -> bool:
        """
        Check if a strategy is registered

        Args:
            strategy_name: Name of the strategy

        Returns:
            True if registered, False otherwise
        """
        return strategy_name in self._strategies

    def unregister_strategy(self, strategy_name: str):
        """
        Remove a strategy from the registry

        Args:
            strategy_name: Name of the strategy to remove

        Raises:
            ValueError: If strategy not found
        """
        if strategy_name not in self._strategies:
            raise ValueError(f"Strategy '{strategy_name}' not found")

        del self._strategies[strategy_name]
        print(f"❌ Unregistered strategy: {strategy_name}")

    def reload_strategies(self):
        """
        Clear registry and rediscover all strategies

        Useful during development when strategy code changes.
        """
        print("🔄 Reloading strategies...")
        self._strategies.clear()
        self.discover_strategies()

    def __repr__(self) -> str:
        return f"StrategyRegistry({len(self._strategies)} strategies registered)"


# Global registry instance
_global_registry = None


def get_registry() -> StrategyRegistry:
    """
    Get the global strategy registry instance

    Returns:
        Global StrategyRegistry instance
    """
    global _global_registry
    if _global_registry is None:
        _global_registry = StrategyRegistry()
        _global_registry.discover_strategies()
    return _global_registry


def reset_registry():
    """Reset the global registry (useful for testing)"""
    global _global_registry
    _global_registry = None
